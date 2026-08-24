"""Pinned MaaFramework facade and opaque Android device sessions."""

from rino_runtime.backends.maa.binding import (
    EXPECTED_MAA_AGENT_BINARY_VERSION,
    EXPECTED_MAA_FRAMEWORK_VERSION,
    EXPECTED_MAA_RUNTIME_VERSION,
    PINNED_OCR_ASSET_COMMIT,
    PINNED_OCR_MODEL_FILES,
    PINNED_OCR_MODEL_KEY,
    MaaAdbDeviceSpec,
    MaaApi,
    MaaBinding,
    MaaController,
    MaaJob,
    MaaOcrCandidateSnapshot,
    MaaOcrSession,
    MaaOcrSnapshot,
    MaaRuntimeConfiguration,
    MaaRuntimeInfo,
    OfficialMaaBinding,
)
from rino_runtime.backends.maa.devices import (
    MaaDeviceService,
)
from rino_runtime.backends.maa.errors import MaaBackendError, MaaBackendErrorCode
from rino_runtime.backends.maa.host import MaaDeviceServiceHost

__all__ = [
    "EXPECTED_MAA_AGENT_BINARY_VERSION",
    "EXPECTED_MAA_FRAMEWORK_VERSION",
    "EXPECTED_MAA_RUNTIME_VERSION",
    "PINNED_OCR_ASSET_COMMIT",
    "PINNED_OCR_MODEL_FILES",
    "PINNED_OCR_MODEL_KEY",
    "MaaAdbDeviceSpec",
    "MaaApi",
    "MaaBackendError",
    "MaaBackendErrorCode",
    "MaaBinding",
    "MaaController",
    "MaaDeviceService",
    "MaaDeviceServiceHost",
    "MaaJob",
    "MaaOcrCandidateSnapshot",
    "MaaOcrSession",
    "MaaOcrSnapshot",
    "MaaRuntimeConfiguration",
    "MaaRuntimeInfo",
    "OfficialMaaBinding",
]
