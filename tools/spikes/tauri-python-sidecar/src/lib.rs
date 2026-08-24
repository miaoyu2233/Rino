mod process;
mod protocol;

pub use process::{SidecarConfig, SidecarSupervisor};
pub use protocol::{
    MAX_FRAME_BYTES, MessageKind, ProtocolEnvelope, ProtocolErrorBody, TransportError, encode_frame,
};
