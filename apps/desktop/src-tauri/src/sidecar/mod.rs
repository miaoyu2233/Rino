//! Supervision of the authoritative Python graph runtime.
//!
//! The desktop shell owns the runtime process lifecycle and the local transport. The
//! frontend reaches the runtime only through the typed commands in `crate::commands`; it
//! never chooses an executable, an argument, or a process operation.

pub mod dispatch;
pub mod launch_resolution;
pub mod process;
pub mod protocol;
pub mod supervisor;

pub use launch_resolution::{
    LaunchSource, ResolvedLaunch, development_adb_executable_from_environment, resolve_launch,
};
pub use process::{SidecarLaunch, SidecarProcess};
pub use protocol::{
    DEFAULT_MAXIMUM_FRAME_BYTES, FrameDecoder, MessageKind, PROTOCOL_VERSION, ProtocolEnvelope,
    ProtocolError, Retryability, TransportError, encode_frame,
};
pub use supervisor::{
    ForwardedDiagnostic, ForwardedEvent, REQUEST_TIMEOUT, RuntimeStatus, SidecarSupervisor,
    SupervisorState,
};
