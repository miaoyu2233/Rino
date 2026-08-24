use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use uuid::Uuid;

use crate::protocol::{FrameDecoder, MessageKind, ProtocolEnvelope, TransportError, encode_frame};

const READER_CHUNK_BYTES: usize = 4096;
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);
const CLEANUP_POLL_INTERVAL: Duration = Duration::from_millis(5);

pub struct SidecarConfig {
    launch: SidecarLaunch,
    mode: String,
}

enum SidecarLaunch {
    PythonScript {
        python_executable: PathBuf,
        script_path: PathBuf,
    },
    StandaloneBinary {
        executable: PathBuf,
    },
}

impl SidecarConfig {
    #[must_use]
    pub fn new(python_executable: PathBuf, script_path: PathBuf) -> Self {
        Self {
            launch: SidecarLaunch::PythonScript {
                python_executable,
                script_path,
            },
            mode: "normal".to_owned(),
        }
    }

    #[must_use]
    pub fn standalone(executable: PathBuf) -> Self {
        Self {
            launch: SidecarLaunch::StandaloneBinary { executable },
            mode: "normal".to_owned(),
        }
    }

    #[must_use]
    pub fn with_mode(mut self, mode: &str) -> Self {
        mode.clone_into(&mut self.mode);
        self
    }
}

enum ReaderEvent {
    Message(ProtocolEnvelope),
    Failure(TransportError),
    Eof,
}

pub struct SidecarSupervisor {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    reader: Option<JoinHandle<()>>,
    stderr_drain: Option<JoinHandle<()>>,
    output: Receiver<ReaderEvent>,
    pending_responses: HashMap<String, ProtocolEnvelope>,
    pending_events: VecDeque<ProtocolEnvelope>,
    process_tree: Option<platform::ProcessTreeGuard>,
}

impl SidecarSupervisor {
    /// Starts the known Sidecar entry point with isolated standard streams and environment.
    ///
    /// # Errors
    ///
    /// Returns an error when a path is not absolute, process creation fails, a required
    /// pipe is unavailable, or the process cannot enter its cleanup boundary.
    pub fn spawn(config: &SidecarConfig) -> Result<Self, TransportError> {
        let mut command = match &config.launch {
            SidecarLaunch::PythonScript {
                python_executable,
                script_path,
            } => {
                if !python_executable.is_absolute() || !script_path.is_absolute() {
                    return Err(TransportError::ProtocolViolation(
                        "sidecar executable and script paths must be absolute",
                    ));
                }
                let mut command = Command::new(python_executable);
                command.arg("-I").arg("-u").arg(script_path);
                command
            }
            SidecarLaunch::StandaloneBinary { executable } => {
                if !executable.is_absolute() {
                    return Err(TransportError::ProtocolViolation(
                        "standalone sidecar executable path must be absolute",
                    ));
                }
                Command::new(executable)
            }
        };
        command
            .arg("--mode")
            .arg(&config.mode)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        apply_minimal_environment(&mut command);

        let mut child = command.spawn()?;
        let process_tree = match platform::ProcessTreeGuard::attach(&child) {
            Ok(guard) => Some(guard),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(TransportError::Io(error));
            }
        };
        let stdin = child.stdin.take().ok_or(TransportError::ProtocolViolation(
            "sidecar stdin pipe is unavailable",
        ))?;
        let stdout = child
            .stdout
            .take()
            .ok_or(TransportError::ProtocolViolation(
                "sidecar stdout pipe is unavailable",
            ))?;
        let stderr = child
            .stderr
            .take()
            .ok_or(TransportError::ProtocolViolation(
                "sidecar stderr pipe is unavailable",
            ))?;
        let (sender, output) = mpsc::channel();
        let reader = thread::spawn(move || read_output(stdout, &sender));
        let stderr_drain = thread::spawn(move || {
            let mut source = stderr;
            let mut discard = [0_u8; 1024];
            while let Ok(bytes_read) = source.read(&mut discard) {
                if bytes_read == 0 {
                    break;
                }
            }
        });

        Ok(Self {
            child: Some(child),
            stdin: Some(stdin),
            reader: Some(reader),
            stderr_drain: Some(stderr_drain),
            output,
            pending_responses: HashMap::new(),
            pending_events: VecDeque::new(),
            process_tree,
        })
    }

    /// Exchanges the protocol compatibility handshake.
    ///
    /// # Errors
    ///
    /// Returns an error on timeout, sidecar exit, I/O failure, or invalid protocol data.
    pub fn handshake(&mut self, timeout: Duration) -> Result<ProtocolEnvelope, TransportError> {
        self.request(
            "system.handshake",
            json!({
                "desktopVersion": "0.0.0-spike",
                "protocolVersionRange": {"minimum": 1, "maximum": 1}
            }),
            timeout,
        )
    }

    /// Sends one request and waits for its correlated response.
    ///
    /// # Errors
    ///
    /// Returns an error on encoding, I/O, timeout, process exit, or protocol failure.
    pub fn request(
        &mut self,
        message_type: &str,
        payload: Value,
        timeout: Duration,
    ) -> Result<ProtocolEnvelope, TransportError> {
        let request_id = self.send_request(message_type, payload)?;
        self.wait_for_response(&request_id, timeout)
    }

    /// Sends one request without waiting for its response.
    ///
    /// # Errors
    ///
    /// Returns an error when the message is invalid, the pipe is closed, or writing fails.
    pub fn send_request(
        &mut self,
        message_type: &str,
        payload: Value,
    ) -> Result<String, TransportError> {
        let request_id = Uuid::new_v4().to_string();
        let frame = encode_frame(&ProtocolEnvelope::request(
            message_type,
            request_id.clone(),
            payload,
        ))?;
        if self.stdin.is_none() {
            return Err(TransportError::SidecarExited(self.exit_code()));
        }
        let stdin = self
            .stdin
            .as_mut()
            .ok_or(TransportError::ProtocolViolation(
                "sidecar stdin pipe became unavailable",
            ))?;
        stdin.write_all(&frame)?;
        stdin.flush()?;
        Ok(request_id)
    }

    /// Waits for the response matching a previously returned request identifier.
    ///
    /// # Errors
    ///
    /// Returns an error on timeout, process exit, output failure, or protocol violation.
    pub fn wait_for_response(
        &mut self,
        request_id: &str,
        timeout: Duration,
    ) -> Result<ProtocolEnvelope, TransportError> {
        if let Some(response) = self.pending_responses.remove(request_id) {
            return Ok(response);
        }
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(TransportError::RequestTimeout);
            }
            match self.output.recv_timeout(remaining) {
                Ok(ReaderEvent::Message(message)) => {
                    match message.message_kind {
                        MessageKind::Response => {
                            let response_id = message.request_id.clone().ok_or(
                                TransportError::ProtocolViolation(
                                    "decoded response has no requestId",
                                ),
                            )?;
                            if response_id == request_id {
                                return Ok(message);
                            }
                            self.pending_responses.insert(response_id, message);
                        }
                        MessageKind::Event => self.pending_events.push_back(message),
                        MessageKind::Request => {
                            return Err(TransportError::ProtocolViolation(
                                "sidecar sent an unexpected request",
                            ));
                        }
                    }
                }
                Ok(ReaderEvent::Failure(error)) => return Err(error),
                Ok(ReaderEvent::Eof) => {
                    return Err(TransportError::SidecarExited(self.exit_code()));
                }
                Err(RecvTimeoutError::Timeout) => return Err(TransportError::RequestTimeout),
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(TransportError::OutputChannelClosed);
                }
            }
        }
    }

    /// Returns the next protocol event while preserving unrelated responses.
    ///
    /// # Errors
    ///
    /// Returns an error on timeout, process exit, output failure, or protocol violation.
    pub fn next_event(&mut self, timeout: Duration) -> Result<ProtocolEnvelope, TransportError> {
        if let Some(event) = self.pending_events.pop_front() {
            return Ok(event);
        }
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(TransportError::RequestTimeout);
            }
            match self.output.recv_timeout(remaining) {
                Ok(ReaderEvent::Message(message)) => {
                    match message.message_kind {
                        MessageKind::Event => return Ok(message),
                        MessageKind::Response => {
                            let response_id = message.request_id.clone().ok_or(
                                TransportError::ProtocolViolation(
                                    "decoded response has no requestId",
                                ),
                            )?;
                            self.pending_responses.insert(response_id, message);
                        }
                        MessageKind::Request => {
                            return Err(TransportError::ProtocolViolation(
                                "sidecar sent an unexpected request",
                            ));
                        }
                    }
                }
                Ok(ReaderEvent::Failure(error)) => return Err(error),
                Ok(ReaderEvent::Eof) => {
                    return Err(TransportError::SidecarExited(self.exit_code()));
                }
                Err(RecvTimeoutError::Timeout) => return Err(TransportError::RequestTimeout),
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(TransportError::OutputChannelClosed);
                }
            }
        }
    }

    /// Requests graceful shutdown and falls back to bounded forced cleanup.
    ///
    /// # Errors
    ///
    /// Returns an error when both graceful shutdown and forced cleanup fail.
    pub fn shutdown(&mut self, timeout: Duration) -> Result<ExitStatus, TransportError> {
        self.request("system.shutdown", json!({}), timeout)?;
        self.stdin.take();
        self.wait_for_exit(timeout)
            .or_else(|_| self.force_stop(CLEANUP_TIMEOUT))
    }

    /// Terminates the sidecar process tree and waits for process exit.
    ///
    /// # Errors
    ///
    /// Returns an error when termination, waiting, or process status inspection fails.
    pub fn force_stop(&mut self, timeout: Duration) -> Result<ExitStatus, TransportError> {
        self.stdin.take();
        self.process_tree.take();
        if let Some(child) = self.child.as_mut()
            && child.try_wait()?.is_none()
        {
            child.kill()?;
        }
        self.wait_for_exit(timeout)
    }

    /// Reports whether the supervised process is still active.
    ///
    /// # Errors
    ///
    /// Returns an error when the operating system process status query fails.
    pub fn is_running(&mut self) -> Result<bool, TransportError> {
        let Some(child) = self.child.as_mut() else {
            return Ok(false);
        };
        Ok(child.try_wait()?.is_none())
    }

    fn wait_for_exit(&mut self, timeout: Duration) -> Result<ExitStatus, TransportError> {
        let deadline = Instant::now() + timeout;
        loop {
            let child = self
                .child
                .as_mut()
                .ok_or(TransportError::SidecarExited(None))?;
            if let Some(status) = child.try_wait()? {
                self.stdin.take();
                self.join_readers();
                return Ok(status);
            }
            if Instant::now() >= deadline {
                return Err(TransportError::ProcessCleanupFailed);
            }
            thread::sleep(CLEANUP_POLL_INTERVAL);
        }
    }

    fn exit_code(&mut self) -> Option<i32> {
        self.child
            .as_mut()
            .and_then(|child| child.try_wait().ok().flatten())
            .and_then(|status| status.code())
    }

    fn join_readers(&mut self) {
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        if let Some(stderr_drain) = self.stderr_drain.take() {
            let _ = stderr_drain.join();
        }
    }
}

impl Drop for SidecarSupervisor {
    fn drop(&mut self) {
        let _ = self.force_stop(CLEANUP_TIMEOUT);
    }
}

fn read_output(mut stdout: impl Read, sender: &mpsc::Sender<ReaderEvent>) {
    let mut decoder = FrameDecoder::new();
    let mut buffer = [0_u8; READER_CHUNK_BYTES];
    loop {
        match stdout.read(&mut buffer) {
            Ok(0) => {
                if let Err(error) = decoder.finish() {
                    let _ = sender.send(ReaderEvent::Failure(error));
                } else {
                    let _ = sender.send(ReaderEvent::Eof);
                }
                return;
            }
            Ok(bytes_read) => match decoder.push(&buffer[..bytes_read]) {
                Ok(messages) => {
                    for message in messages {
                        if sender.send(ReaderEvent::Message(message)).is_err() {
                            return;
                        }
                    }
                }
                Err(error) => {
                    let _ = sender.send(ReaderEvent::Failure(error));
                    return;
                }
            },
            Err(error) => {
                let _ = sender.send(ReaderEvent::Failure(TransportError::Io(error)));
                return;
            }
        }
    }
}

fn apply_minimal_environment(command: &mut Command) {
    let inherited_keys = ["SystemRoot", "WINDIR", "SYSTEMDRIVE", "TEMP", "TMP"];
    let inherited_values = inherited_keys
        .iter()
        .filter_map(|key| std::env::var_os(key).map(|value| (OsString::from(key), value)))
        .collect::<Vec<_>>();
    command.env_clear();
    command.envs(inherited_values);
    command.env("PYTHONIOENCODING", "utf-8");
    command.env("PYTHONUNBUFFERED", "1");
    command.env("PYTHONNOUSERSITE", "1");
}

#[cfg(windows)]
mod platform {
    #![allow(unsafe_code)]

    use std::io;
    use std::mem::{self, size_of};
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::ptr;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    pub(super) struct ProcessTreeGuard {
        job: HANDLE,
    }

    impl ProcessTreeGuard {
        pub(super) fn attach(child: &Child) -> io::Result<Self> {
            let job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
            if job.is_null() {
                return Err(io::Error::last_os_error());
            }
            let mut information: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { mem::zeroed() };
            information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let information_size = u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
                .map_err(|_| io::Error::other("job information size is unsupported"))?;
            let configured = unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    ptr::from_ref(&information).cast(),
                    information_size,
                )
            };
            if configured == 0 {
                unsafe { CloseHandle(job) };
                return Err(io::Error::last_os_error());
            }
            let process = child.as_raw_handle().cast();
            let assigned = unsafe { AssignProcessToJobObject(job, process) };
            if assigned == 0 {
                unsafe { CloseHandle(job) };
                return Err(io::Error::last_os_error());
            }
            Ok(Self { job })
        }
    }

    impl Drop for ProcessTreeGuard {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.job) };
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::io;
    use std::process::Child;

    pub(super) struct ProcessTreeGuard;

    impl ProcessTreeGuard {
        pub(super) fn attach(_child: &Child) -> io::Result<Self> {
            Ok(Self)
        }
    }
}
