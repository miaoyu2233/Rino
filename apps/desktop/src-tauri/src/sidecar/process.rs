//! Runtime process ownership.
//!
//! The desktop shell starts one known bundled executable with fixed arguments; neither the
//! program name nor its arguments are ever supplied by the frontend or by project content.
//! On Windows the child is assigned to a Job Object so a desktop crash cannot leave an
//! orphaned runtime holding a device.

use std::ffi::OsString;
use std::io::{Read, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::protocol::{FrameDecoder, ProtocolEnvelope, TransportError};

const READER_CHUNK_BYTES: usize = 8192;
const CLEANUP_POLL_INTERVAL: Duration = Duration::from_millis(5);
const DIAGNOSTIC_LINE_LIMIT: usize = 4096;
const ADB_EXECUTABLE_ARGUMENT: &str = "--adb-executable";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// One item read from the runtime's standard output.
pub enum ReaderEvent {
    Message(Box<ProtocolEnvelope>),
    Failure(TransportError),
    Eof,
}

/// The bundled runtime executable and the arguments the desktop shell controls.
pub struct SidecarLaunch {
    executable: PathBuf,
    arguments: Vec<OsString>,
    owned_adb_executable: Option<PathBuf>,
}

impl SidecarLaunch {
    /// Describes the fixed runtime entry point.
    ///
    /// # Errors
    ///
    /// Returns an error when the executable path is not absolute, because a relative path
    /// would resolve against the working directory and allow current-directory hijacking.
    pub fn new(executable: PathBuf, arguments: Vec<OsString>) -> Result<Self, TransportError> {
        if !executable.is_absolute() {
            return Err(TransportError::ProtocolViolation(
                "the runtime executable path must be absolute",
            ));
        }
        Ok(Self {
            executable,
            arguments,
            owned_adb_executable: None,
        })
    }

    /// Marks the configured ADB executable as application-owned for bounded exit cleanup.
    ///
    /// # Errors
    ///
    /// Returns an error unless the path is the same absolute existing executable already
    /// present in the fixed runtime arguments.
    pub fn with_owned_adb_executable(
        mut self,
        adb_executable: PathBuf,
    ) -> Result<Self, TransportError> {
        if !adb_executable.is_absolute()
            || !adb_executable.is_file()
            || self.configured_adb_executable() != Some(adb_executable.as_path())
        {
            return Err(TransportError::ProtocolViolation(
                "the owned ADB executable must match the configured absolute executable",
            ));
        }
        self.owned_adb_executable = Some(adb_executable);
        Ok(self)
    }

    #[must_use]
    pub fn executable(&self) -> &Path {
        &self.executable
    }

    fn configured_adb_executable(&self) -> Option<&Path> {
        let adb_executable = self
            .arguments
            .windows(2)
            .find(|arguments| arguments[0] == ADB_EXECUTABLE_ARGUMENT)
            .map(|arguments| Path::new(&arguments[1]))?;
        if !adb_executable.is_absolute() || !adb_executable.is_file() {
            return None;
        }
        Some(adb_executable)
    }

    fn configured_adb_directory(&self) -> Option<&Path> {
        self.configured_adb_executable()?.parent()
    }

    #[must_use]
    #[cfg(test)]
    pub(crate) fn owned_adb_executable(&self) -> Option<&Path> {
        self.owned_adb_executable.as_deref()
    }
}

/// A running runtime process together with its reader threads.
pub struct SidecarProcess {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    reader: Option<JoinHandle<()>>,
    diagnostics: Option<JoinHandle<()>>,
    process_tree: Option<platform::ProcessTreeGuard>,
    owned_adb_executable: Option<PathBuf>,
}

impl SidecarProcess {
    /// Starts the runtime with an isolated environment and piped standard streams.
    ///
    /// The protocol receiver is returned separately so the caller owns message dispatch:
    /// runtime events must be forwarded as they arrive, not only while a request is
    /// waiting for its response.
    ///
    /// # Errors
    ///
    /// Returns an error when process creation fails, a required pipe is unavailable, or the
    /// process cannot be placed under process-tree ownership.
    pub fn spawn(
        launch: &SidecarLaunch,
        maximum_frame_bytes: usize,
        diagnostic_sink: Sender<String>,
    ) -> Result<(Self, Receiver<ReaderEvent>), TransportError> {
        let mut command = Command::new(&launch.executable);
        command
            .args(&launch.arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_creation(&mut command);
        apply_minimal_environment(&mut command, launch);
        let owned_adb_executable = launch.owned_adb_executable.clone();

        let mut child = command.spawn()?;
        let process_tree = match platform::ProcessTreeGuard::attach(&child) {
            Ok(guard) => Some(guard),
            Err(error) => {
                let _ignored = child.kill();
                let _ignored = child.wait();
                return Err(TransportError::Io(error));
            }
        };

        let stdin = child.stdin.take().ok_or(TransportError::ProtocolViolation(
            "the runtime standard input pipe is unavailable",
        ))?;
        let stdout = child
            .stdout
            .take()
            .ok_or(TransportError::ProtocolViolation(
                "the runtime standard output pipe is unavailable",
            ))?;
        let stderr = child
            .stderr
            .take()
            .ok_or(TransportError::ProtocolViolation(
                "the runtime standard error pipe is unavailable",
            ))?;

        let (sender, output) = mpsc::channel();
        let reader = thread::spawn(move || read_protocol(stdout, &sender, maximum_frame_bytes));
        let diagnostics = thread::spawn(move || read_diagnostics(stderr, &diagnostic_sink));

        Ok((
            Self {
                child: Some(child),
                stdin: Some(stdin),
                reader: Some(reader),
                diagnostics: Some(diagnostics),
                process_tree,
                owned_adb_executable,
            },
            output,
        ))
    }

    /// Writes one encoded frame to the runtime.
    ///
    /// # Errors
    ///
    /// Returns an error when the process has stopped or the pipe write fails.
    pub fn write_frame(&mut self, frame: &[u8]) -> Result<(), TransportError> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or(TransportError::SidecarUnavailable)?;
        stdin.write_all(frame)?;
        stdin.flush()?;
        Ok(())
    }

    /// Closes the runtime's standard input so it observes end of input.
    pub fn close_input(&mut self) {
        self.stdin.take();
    }

    /// Reports whether the process is still running.
    ///
    /// # Errors
    ///
    /// Returns an error when the operating-system status query fails.
    pub fn is_running(&mut self) -> Result<bool, TransportError> {
        let Some(child) = self.child.as_mut() else {
            return Ok(false);
        };
        Ok(child.try_wait()?.is_none())
    }

    /// Waits for process exit within the timeout.
    ///
    /// # Errors
    ///
    /// Returns an error when the status query fails or the process outlives the timeout.
    pub fn wait_for_exit(&mut self, timeout: Duration) -> Result<ExitStatus, TransportError> {
        let deadline = Instant::now() + timeout;
        loop {
            let child = self
                .child
                .as_mut()
                .ok_or(TransportError::SidecarUnavailable)?;
            if let Some(status) = child.try_wait()? {
                self.stdin.take();
                self.join_readers();
                self.stop_owned_adb_server(timeout)?;
                return Ok(status);
            }
            if Instant::now() >= deadline {
                return Err(TransportError::ProcessCleanupFailed);
            }
            thread::sleep(CLEANUP_POLL_INTERVAL);
        }
    }

    /// Terminates the process tree and waits for exit.
    ///
    /// # Errors
    ///
    /// Returns an error when termination or the following status query fails.
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

    #[must_use]
    pub fn exit_code(&mut self) -> Option<i32> {
        self.child
            .as_mut()
            .and_then(|child| child.try_wait().ok().flatten())
            .and_then(|status| status.code())
    }

    fn join_readers(&mut self) {
        if let Some(reader) = self.reader.take() {
            let _ignored = reader.join();
        }
        if let Some(diagnostics) = self.diagnostics.take() {
            let _ignored = diagnostics.join();
        }
    }

    fn stop_owned_adb_server(&mut self, timeout: Duration) -> Result<(), TransportError> {
        let Some(adb_executable) = self.owned_adb_executable.as_deref() else {
            return Ok(());
        };
        let mut cleanup = owned_adb_cleanup_command(adb_executable).spawn()?;
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = cleanup.try_wait()? {
                if status.success() {
                    self.owned_adb_executable.take();
                    return Ok(());
                }
                return Err(TransportError::ProcessCleanupFailed);
            }
            if Instant::now() >= deadline {
                let _ignored = cleanup.kill();
                let _ignored = cleanup.wait();
                return Err(TransportError::ProcessCleanupFailed);
            }
            thread::sleep(CLEANUP_POLL_INTERVAL);
        }
    }
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        let _ignored = self.force_stop(Duration::from_secs(2));
    }
}

fn read_protocol(
    mut stdout: ChildStdout,
    sender: &Sender<ReaderEvent>,
    maximum_frame_bytes: usize,
) {
    let mut decoder = FrameDecoder::new(maximum_frame_bytes);
    let mut buffer = [0_u8; READER_CHUNK_BYTES];
    loop {
        match stdout.read(&mut buffer) {
            Ok(0) => {
                let event = decoder
                    .finish()
                    .map_or_else(ReaderEvent::Failure, |()| ReaderEvent::Eof);
                let _ignored = sender.send(event);
                return;
            }
            Ok(bytes_read) => match decoder.push(&buffer[..bytes_read]) {
                Ok(messages) => {
                    for message in messages {
                        if sender
                            .send(ReaderEvent::Message(Box::new(message)))
                            .is_err()
                        {
                            return;
                        }
                    }
                }
                Err(error) => {
                    let _ignored = sender.send(ReaderEvent::Failure(error));
                    return;
                }
            },
            Err(error) => {
                let _ignored = sender.send(ReaderEvent::Failure(TransportError::Io(error)));
                return;
            }
        }
    }
}

/// Forwards runtime diagnostics line by line with a bounded line length.
///
/// The runtime already redacts these lines; the length bound protects the desktop from a
/// defective build that emits an unbounded line.
fn read_diagnostics(mut stderr: impl Read, sink: &Sender<String>) {
    let mut pending = Vec::new();
    let mut buffer = [0_u8; READER_CHUNK_BYTES];
    loop {
        match stderr.read(&mut buffer) {
            Ok(0) => {
                emit_diagnostic_line(&pending, sink);
                return;
            }
            Ok(bytes_read) => {
                for byte in &buffer[..bytes_read] {
                    if *byte == b'\n' {
                        emit_diagnostic_line(&pending, sink);
                        pending.clear();
                    } else if pending.len() < DIAGNOSTIC_LINE_LIMIT {
                        pending.push(*byte);
                    }
                }
            }
            Err(_) => return,
        }
    }
}

fn emit_diagnostic_line(line: &[u8], sink: &Sender<String>) {
    if line.is_empty() {
        return;
    }
    if let Ok(text) = str::from_utf8(line) {
        let _ignored = sink.send(text.trim_end().to_owned());
    }
}

#[cfg(windows)]
fn configure_process_creation(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_process_creation(_command: &mut Command) {}

/// Starts the runtime from a minimal environment.
///
/// Inheriting the full environment would let `PATH`, `PYTHONPATH`, or `PYTHONHOME` from the
/// user session change which interpreter or modules the bundled runtime loads. When ADB is
/// configured, its validated parent directory is the only search path admitted because the
/// binding requires that directory while enumerating devices.
fn apply_minimal_environment(command: &mut Command, launch: &SidecarLaunch) {
    apply_isolated_environment(command, launch.configured_adb_directory());
}

fn apply_isolated_environment(command: &mut Command, adb_directory: Option<&Path>) {
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
    if let Some(adb_directory) = adb_directory {
        command.env("PATH", adb_directory);
    }
}

fn owned_adb_cleanup_command(adb_executable: &Path) -> Command {
    let mut command = Command::new(adb_executable);
    command
        .arg("kill-server")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_process_creation(&mut command);
    apply_isolated_environment(&mut command, adb_executable.parent());
    command
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::expect_used,
        reason = "test setup must report an unavailable executable path"
    )]

    use std::ffi::OsStr;

    use super::*;

    fn environment_value<'command>(
        command: &'command Command,
        expected_key: &str,
    ) -> Option<&'command OsStr> {
        command.get_envs().find_map(|(key, value)| {
            key.eq_ignore_ascii_case(OsStr::new(expected_key))
                .then_some(value)
                .flatten()
        })
    }

    #[test]
    fn minimal_environment_exposes_only_the_configured_adb_directory_as_path() {
        let executable = std::env::current_exe().expect("test executable path");
        let adb_directory = executable.parent().expect("test executable directory");
        let launch = SidecarLaunch::new(
            executable.clone(),
            vec![
                OsString::from(ADB_EXECUTABLE_ARGUMENT),
                executable.clone().into_os_string(),
            ],
        )
        .expect("valid sidecar launch");
        let mut command = Command::new(launch.executable());

        apply_minimal_environment(&mut command, &launch);

        assert_eq!(
            environment_value(&command, "PATH"),
            Some(adb_directory.as_os_str())
        );
    }

    #[test]
    fn minimal_environment_omits_path_without_an_explicit_adb_executable() {
        let executable = std::env::current_exe().expect("test executable path");
        let launch =
            SidecarLaunch::new(executable, Vec::new()).expect("valid sidecar launch without ADB");
        let mut command = Command::new(launch.executable());

        apply_minimal_environment(&mut command, &launch);

        assert_eq!(environment_value(&command, "PATH"), None);
    }

    #[test]
    fn owned_adb_requires_the_same_fixed_configured_executable()
    -> Result<(), Box<dyn std::error::Error>> {
        let executable = std::env::current_exe()?;
        let launch = SidecarLaunch::new(
            executable.clone(),
            vec![
                OsString::from(ADB_EXECUTABLE_ARGUMENT),
                executable.clone().into_os_string(),
            ],
        )?
        .with_owned_adb_executable(executable.clone())?;

        assert_eq!(launch.owned_adb_executable(), Some(executable.as_path()));
        Ok(())
    }

    #[test]
    fn owned_adb_cleanup_uses_only_the_fixed_kill_server_argument()
    -> Result<(), Box<dyn std::error::Error>> {
        let executable = std::env::current_exe()?;
        let command = owned_adb_cleanup_command(&executable);

        assert_eq!(command.get_program(), executable.as_os_str());
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![OsStr::new("kill-server")]
        );
        assert_eq!(
            environment_value(&command, "PATH"),
            executable.parent().map(Path::as_os_str)
        );
        Ok(())
    }

    #[test]
    fn owned_adb_cleanup_waits_for_success_and_releases_ownership()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut process = SidecarProcess {
            child: None,
            stdin: None,
            reader: None,
            diagnostics: None,
            process_tree: None,
            owned_adb_executable: Some(std::env::current_exe()?),
        };

        process.stop_owned_adb_server(Duration::from_secs(5))?;

        assert!(process.owned_adb_executable.is_none());
        Ok(())
    }
}

#[cfg(windows)]
mod platform {
    //! Windows process-tree ownership.
    //!
    //! ADR-0001 requires that the runtime and any process it starts cannot outlive the
    //! desktop application. Windows offers no safe-Rust equivalent of a Job Object, so this
    //! module carries the only `unsafe` in the desktop crate. Every call below passes a
    //! handle this module owns, checks the documented failure return, and releases the
    //! handle in `Drop`.
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

    // SAFETY: a Windows job handle is a process-wide kernel object reference that any
    // thread may use, and the guard owns it exclusively until `Drop` closes it once.
    unsafe impl Send for ProcessTreeGuard {}

    impl ProcessTreeGuard {
        pub(super) fn attach(child: &Child) -> io::Result<Self> {
            // SAFETY: both pointers are null, which CreateJobObjectW documents as "default
            // security attributes and an unnamed job".
            let job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
            if job.is_null() {
                return Err(io::Error::last_os_error());
            }

            // SAFETY: the structure is plain old data, so an all-zero value is a valid
            // initial state before the one field below is set.
            let mut information: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { mem::zeroed() };
            information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let information_size = u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
                .map_err(|_| io::Error::other("the job information size is unsupported"))?;

            // SAFETY: `job` is the handle just created, the pointer refers to the local
            // structure above, and the length matches that structure exactly.
            let configured = unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    ptr::from_ref(&information).cast(),
                    information_size,
                )
            };
            if configured == 0 {
                // SAFETY: `job` is a live handle this function owns and does not reuse.
                unsafe { CloseHandle(job) };
                return Err(io::Error::last_os_error());
            }

            let process = child.as_raw_handle().cast();
            // SAFETY: `job` is live and `process` is the running child's handle, which the
            // borrow of `child` keeps open for the duration of this call.
            let assigned = unsafe { AssignProcessToJobObject(job, process) };
            if assigned == 0 {
                // SAFETY: `job` is a live handle this function owns and does not reuse.
                unsafe { CloseHandle(job) };
                return Err(io::Error::last_os_error());
            }
            Ok(Self { job })
        }
    }

    impl Drop for ProcessTreeGuard {
        fn drop(&mut self) {
            // SAFETY: `job` was created in `attach`, is closed exactly once here, and is
            // not used afterwards. Closing the last handle terminates the job's processes.
            unsafe { CloseHandle(self.job) };
        }
    }
}

#[cfg(not(windows))]
mod platform {
    //! Placeholder process-tree ownership for non-Windows development hosts.
    //!
    //! Windows is the launch target. A process-group equivalent is required before another
    //! platform becomes supported, so this placeholder must not be treated as cleanup.

    use std::io;
    use std::process::Child;

    pub(super) struct ProcessTreeGuard;

    impl ProcessTreeGuard {
        pub(super) const fn attach(_child: &Child) -> io::Result<Self> {
            Ok(Self)
        }
    }
}
