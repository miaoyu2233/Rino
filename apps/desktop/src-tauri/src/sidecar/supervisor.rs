//! Runtime lifecycle supervision.
//!
//! One supervisor owns the runtime process, correlates requests with responses, forwards
//! events, and enforces the restart policy. Every response and event carries the generation
//! it belongs to, so output from a previous runtime instance is discarded rather than
//! attributed to the current one.

use std::sync::Arc;
use std::sync::mpsc::{Receiver, Sender, TryRecvError, channel};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use super::dispatch::{ResponseMailbox, spawn_dispatcher};
use super::process::{SidecarLaunch, SidecarProcess};
use super::protocol::{
    DEFAULT_MAXIMUM_FRAME_BYTES, MAXIMUM_SUPPORTED_FRAME_BYTES, PROTOCOL_VERSION, ProtocolEnvelope,
    ProtocolError, TransportError, encode_frame,
};

pub const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
pub const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
pub const FORCED_CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);
pub const MAXIMUM_AUTOMATIC_RESTARTS: u32 = 3;
const RESTART_BACKOFF_BASE: Duration = Duration::from_millis(250);

/// The desktop-visible lifecycle state of the runtime.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SupervisorState {
    Stopped,
    Starting,
    Handshaking,
    Ready,
    Degraded,
    Restarting,
    Stopping,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MaaRuntimeAvailability {
    Available,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaaRuntimeStatus {
    pub state: MaaRuntimeAvailability,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_version: Option<String>,
}

/// A runtime status snapshot for the frontend.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub state: SupervisorState,
    pub generation: u64,
    pub automatic_restarts: u32,
    pub protocol_version: u16,
    pub maximum_frame_bytes: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maa_runtime: Option<MaaRuntimeStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature_flags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<ProtocolError>,
}

/// One event forwarded to the frontend, tagged with its runtime generation.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardedEvent {
    pub generation: u64,
    pub message_type: String,
    pub event_id: String,
    pub sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    pub payload: Value,
}

/// A bounded, redacted diagnostic line produced by the runtime.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardedDiagnostic {
    pub generation: u64,
    pub line: String,
}

/// The outcome of one request.
pub enum RequestOutcome {
    Result(Value),
    Failure(Box<ProtocolError>),
}

/// A runtime operation result.
///
/// The error is boxed because a structured error is a comparatively large domain value and
/// every success path would otherwise carry its size.
pub type RuntimeResult<T> = Result<T, Box<ProtocolError>>;

/// Supervises one runtime process across restarts.
pub struct SidecarSupervisor {
    launch: SidecarLaunch,
    desktop_version: String,
    process: Option<SidecarProcess>,
    state: SupervisorState,
    generation: u64,
    automatic_restarts: u32,
    maximum_frame_bytes: usize,
    runtime_version: Option<String>,
    runtime_mode: Option<String>,
    maa_runtime: Option<MaaRuntimeStatus>,
    feature_flags: Option<Vec<String>>,
    last_error: Option<ProtocolError>,
    mailbox: Arc<ResponseMailbox>,
    event_sink: Sender<ForwardedEvent>,
    diagnostic_sender: Sender<String>,
    diagnostic_receiver: Receiver<String>,
    diagnostic_sink: Sender<ForwardedDiagnostic>,
}

impl SidecarSupervisor {
    #[must_use]
    pub fn new(
        launch: SidecarLaunch,
        desktop_version: String,
        event_sink: Sender<ForwardedEvent>,
        diagnostic_sink: Sender<ForwardedDiagnostic>,
    ) -> Self {
        let (diagnostic_sender, diagnostic_receiver) = channel();
        Self {
            launch,
            desktop_version,
            process: None,
            state: SupervisorState::Stopped,
            generation: 0,
            automatic_restarts: 0,
            maximum_frame_bytes: DEFAULT_MAXIMUM_FRAME_BYTES,
            runtime_version: None,
            runtime_mode: None,
            maa_runtime: None,
            feature_flags: None,
            last_error: None,
            mailbox: Arc::new(ResponseMailbox::new()),
            event_sink,
            diagnostic_sender,
            diagnostic_receiver,
            diagnostic_sink,
        }
    }

    #[must_use]
    pub fn status(&self) -> RuntimeStatus {
        RuntimeStatus {
            state: self.state,
            generation: self.generation,
            automatic_restarts: self.automatic_restarts,
            protocol_version: PROTOCOL_VERSION,
            maximum_frame_bytes: self.maximum_frame_bytes,
            runtime_version: self.runtime_version.clone(),
            runtime_mode: self.runtime_mode.clone(),
            maa_runtime: self.maa_runtime.clone(),
            feature_flags: self.feature_flags.clone(),
            last_error: self.last_error.clone(),
        }
    }

    #[must_use]
    pub const fn state(&self) -> SupervisorState {
        self.state
    }

    #[must_use]
    pub const fn generation(&self) -> u64 {
        self.generation
    }

    /// Starts the runtime and completes the protocol handshake.
    ///
    /// # Errors
    ///
    /// Returns a structured error when the process cannot start, the handshake times out,
    /// or the runtime reports an incompatible protocol version.
    pub fn start(&mut self) -> RuntimeResult<RuntimeStatus> {
        if matches!(self.state, SupervisorState::Ready) {
            return Ok(self.status());
        }
        self.generation = self.generation.saturating_add(1);
        self.mailbox = Arc::new(ResponseMailbox::new());
        self.maximum_frame_bytes = DEFAULT_MAXIMUM_FRAME_BYTES;
        self.runtime_version = None;
        self.runtime_mode = None;
        self.maa_runtime = None;
        self.feature_flags = None;
        self.state = SupervisorState::Starting;

        let (process, output) = SidecarProcess::spawn(
            &self.launch,
            MAXIMUM_SUPPORTED_FRAME_BYTES,
            self.diagnostic_sender.clone(),
        )
        .map_err(|error| self.fail(&error))?;
        spawn_dispatcher(
            output,
            Arc::clone(&self.mailbox),
            self.event_sink.clone(),
            self.generation,
        );
        self.process = Some(process);
        self.state = SupervisorState::Handshaking;

        match self.perform_handshake() {
            Ok(()) => {
                self.state = SupervisorState::Ready;
                self.last_error = None;
                Ok(self.status())
            }
            Err(error) => {
                self.stop_process();
                self.state = SupervisorState::Failed;
                self.last_error = Some((*error).clone());
                Err(error)
            }
        }
    }

    /// Sends one request and waits for its correlated response.
    ///
    /// # Errors
    ///
    /// Returns a structured error when the runtime is unavailable, the request times out,
    /// the process exits, or the runtime answers with an error.
    pub fn request(
        &mut self,
        message_type: &str,
        payload: Value,
        timeout: Duration,
    ) -> RuntimeResult<Value> {
        if !matches!(
            self.state,
            SupervisorState::Ready | SupervisorState::Degraded
        ) {
            return Err(Box::new(ProtocolError::sidecar_unavailable(
                "The runtime is not ready to accept requests.".to_owned(),
            )));
        }
        match self.exchange(message_type, payload, timeout) {
            Ok(RequestOutcome::Result(value)) => Ok(value),
            Ok(RequestOutcome::Failure(error)) => Err(error),
            Err(error) => {
                let structured = Self::classify(&error);
                if matches!(
                    error,
                    TransportError::SidecarExited(_) | TransportError::OutputChannelClosed
                ) {
                    self.mark_process_lost();
                }
                Err(structured)
            }
        }
    }

    /// Requests graceful shutdown and falls back to bounded forced cleanup.
    pub fn shutdown(&mut self) -> RuntimeStatus {
        if self.process.is_some() {
            self.state = SupervisorState::Stopping;
            let _ignored = self.exchange("system.shutdown", json!({}), SHUTDOWN_TIMEOUT);
            self.stop_process();
        }
        self.state = SupervisorState::Stopped;
        self.mailbox.reset();
        self.status()
    }

    /// Restarts the runtime after a crash when the restart budget allows it.
    ///
    /// # Errors
    ///
    /// Returns a structured error when the restart budget is exhausted or the new process
    /// fails to start.
    pub fn restart(&mut self, automatic: bool) -> RuntimeResult<RuntimeStatus> {
        if automatic && self.automatic_restarts >= MAXIMUM_AUTOMATIC_RESTARTS {
            let error = ProtocolError::sidecar_unavailable(
                "The runtime exceeded its automatic restart budget and needs an explicit \
                 restart."
                    .to_owned(),
            );
            self.state = SupervisorState::Failed;
            self.last_error = Some(error.clone());
            return Err(Box::new(error));
        }
        self.state = SupervisorState::Restarting;
        self.stop_process();
        if automatic {
            self.automatic_restarts = self.automatic_restarts.saturating_add(1);
            std::thread::sleep(RESTART_BACKOFF_BASE * self.automatic_restarts);
        } else {
            self.automatic_restarts = 0;
        }
        self.start()
    }

    /// Drains runtime diagnostics that arrived since the last call.
    pub fn drain_diagnostics(&self) {
        loop {
            match self.diagnostic_receiver.try_recv() {
                Ok(line) => {
                    let _ignored = self.diagnostic_sink.send(ForwardedDiagnostic {
                        generation: self.generation,
                        line,
                    });
                }
                Err(TryRecvError::Empty | TryRecvError::Disconnected) => return,
            }
        }
    }

    fn perform_handshake(&mut self) -> RuntimeResult<()> {
        let payload = json!({
            "desktopVersion": self.desktop_version,
            "protocolVersionRange": {"minimum": PROTOCOL_VERSION, "maximum": PROTOCOL_VERSION},
            "maximumFrameBytes": DEFAULT_MAXIMUM_FRAME_BYTES,
        });
        let outcome = self
            .exchange("system.handshake", payload, STARTUP_TIMEOUT)
            .map_err(|error| Self::classify(&error))?;
        let result = match outcome {
            RequestOutcome::Result(value) => value,
            RequestOutcome::Failure(error) => return Err(error),
        };

        let reported_version = result
            .get("protocolVersion")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        if reported_version != u64::from(PROTOCOL_VERSION) {
            return Err(Box::new(ProtocolError::new(
                "PROTOCOL_INCOMPATIBLE",
                "runtime.error.protocolIncompatible",
                format!(
                    "The runtime reported protocol version {reported_version}; the desktop \
                     requires version {PROTOCOL_VERSION}."
                ),
                super::protocol::Retryability::Never,
            )));
        }

        if let Some(frame_bytes) = result.get("maximumFrameBytes").and_then(Value::as_u64) {
            let negotiated = usize::try_from(frame_bytes).unwrap_or(DEFAULT_MAXIMUM_FRAME_BYTES);
            self.maximum_frame_bytes = negotiated.min(MAXIMUM_SUPPORTED_FRAME_BYTES);
        }
        self.runtime_version = result
            .get("runtimeVersion")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        self.runtime_mode = result
            .get("runtimeMode")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let maa_runtime = result
            .get("maaRuntime")
            .cloned()
            .ok_or_else(|| invalid_handshake("The runtime omitted its Maa availability."))?;
        let maa_runtime: MaaRuntimeStatus = serde_json::from_value(maa_runtime)
            .map_err(|_| invalid_handshake("The runtime reported invalid Maa availability."))?;
        if matches!(maa_runtime.state, MaaRuntimeAvailability::Available)
            && (maa_runtime.binding_version.is_none() || maa_runtime.native_version.is_none())
        {
            return Err(invalid_handshake(
                "An available Maa runtime requires binding and native versions.",
            ));
        }
        let feature_flags = result
            .get("featureFlags")
            .cloned()
            .ok_or_else(|| invalid_handshake("The runtime omitted its feature flags."))?;
        let feature_flags: Vec<String> = serde_json::from_value(feature_flags)
            .map_err(|_| invalid_handshake("The runtime reported invalid feature flags."))?;
        if feature_flags.len() > 64 || feature_flags.iter().any(|flag| flag.len() > 64) {
            return Err(invalid_handshake(
                "The runtime feature flags exceeded their canonical limits.",
            ));
        }
        self.maa_runtime = Some(maa_runtime);
        self.feature_flags = Some(feature_flags);
        Ok(())
    }

    fn exchange(
        &mut self,
        message_type: &str,
        payload: Value,
        timeout: Duration,
    ) -> Result<RequestOutcome, TransportError> {
        let request_id = Uuid::new_v4().to_string();
        let envelope = ProtocolEnvelope::request(message_type, request_id.clone(), payload);
        let frame = encode_frame(&envelope, self.maximum_frame_bytes)?;

        let process = self
            .process
            .as_mut()
            .ok_or(TransportError::SidecarUnavailable)?;
        process.write_frame(&frame)?;

        let response = self.wait_for_response(&request_id, timeout)?;
        if let Some(error) = response.error {
            let structured: ProtocolError =
                serde_json::from_value(error).map_err(TransportError::InvalidJson)?;
            return Ok(RequestOutcome::Failure(Box::new(structured)));
        }
        Ok(RequestOutcome::Result(
            response.result.unwrap_or_else(|| json!({})),
        ))
    }

    fn wait_for_response(
        &mut self,
        request_id: &str,
        timeout: Duration,
    ) -> Result<ProtocolEnvelope, TransportError> {
        if self.process.is_none() {
            return Err(TransportError::SidecarUnavailable);
        }
        match self.mailbox.wait_for(request_id, timeout) {
            Err(TransportError::SidecarExited(None)) => Err(TransportError::SidecarExited(
                self.process.as_mut().and_then(SidecarProcess::exit_code),
            )),
            outcome => outcome,
        }
    }

    fn classify(error: &TransportError) -> Box<ProtocolError> {
        let detail = error.safe_detail();
        Box::new(match error.code() {
            "REQUEST_TIMEOUT" => ProtocolError::request_timeout(detail),
            "SIDECAR_UNAVAILABLE" => ProtocolError::sidecar_unavailable(detail),
            _ => ProtocolError::transport_failure(detail),
        })
    }

    fn fail(&mut self, error: &TransportError) -> Box<ProtocolError> {
        let structured = Self::classify(error);
        self.state = SupervisorState::Failed;
        self.last_error = Some((*structured).clone());
        structured
    }

    fn mark_process_lost(&mut self) {
        self.stop_process();
        self.state = SupervisorState::Degraded;
        self.mailbox.reset();
    }

    fn stop_process(&mut self) {
        if let Some(mut process) = self.process.take() {
            process.close_input();
            if process.wait_for_exit(SHUTDOWN_TIMEOUT).is_err() {
                let _ignored = process.force_stop(FORCED_CLEANUP_TIMEOUT);
            }
        }
    }
}

fn invalid_handshake(detail: &str) -> Box<ProtocolError> {
    Box::new(ProtocolError::new(
        "PROTOCOL_INCOMPATIBLE",
        "runtime.error.protocolIncompatible",
        detail.to_owned(),
        super::protocol::Retryability::Never,
    ))
}
