"""Deterministic automation backend for contract and vertical-slice tests."""

from __future__ import annotations

from dataclasses import dataclass

from rino_runtime.backends.android_actions import (
    AndroidKey,
    android_key_code,
    validate_android_intent,
)
from rino_runtime.backends.base import AutomationOperationCorrelation
from rino_runtime.execution_control import CancellationProbe
from rino_runtime.nodes.execution import (
    RuntimeImageReference,
    RuntimeOcrCandidate,
    RuntimeOcrResult,
    RuntimePoint,
    RuntimeRect,
)


@dataclass(frozen=True, slots=True)
class FakeAutomationScenario:
    width: int = 1280
    height: int = 720
    candidates: tuple[RuntimeOcrCandidate, ...] = ()
    capture_failure: bool = False
    recognition_failure: bool = False
    action_failure: bool = False

    def __post_init__(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise ValueError("Fake capture dimensions must be positive.")


@dataclass(frozen=True, slots=True)
class FakeClickRecord:
    device_key: str
    point: RuntimePoint


@dataclass(frozen=True, slots=True)
class FakeTouchActionRecord:
    device_key: str
    action_type: str
    points: tuple[RuntimePoint, ...]
    duration_milliseconds: int
    secondary_start_delay_milliseconds: int = 0


@dataclass(frozen=True, slots=True)
class FakeAppLaunchRecord:
    device_key: str
    intent: str


@dataclass(frozen=True, slots=True)
class FakeAndroidKeyRecord:
    device_key: str
    key: AndroidKey
    key_code: int


class FakeAutomationBackend:
    """Returns configured synthetic results and records safe action invocations."""

    def __init__(self, scenario: FakeAutomationScenario) -> None:
        self._scenario = scenario
        self._capture_generation = 0
        self._clicks: list[FakeClickRecord] = []
        self._touch_actions: list[FakeTouchActionRecord] = []
        self._app_launches: list[FakeAppLaunchRecord] = []
        self._android_keys: list[FakeAndroidKeyRecord] = []

    @property
    def clicks(self) -> tuple[FakeClickRecord, ...]:
        return tuple(self._clicks)

    @property
    def touch_actions(self) -> tuple[FakeTouchActionRecord, ...]:
        return tuple(self._touch_actions)

    @property
    def app_launches(self) -> tuple[FakeAppLaunchRecord, ...]:
        return tuple(self._app_launches)

    @property
    def android_keys(self) -> tuple[FakeAndroidKeyRecord, ...]:
        return tuple(self._android_keys)

    async def capture_screen(
        self,
        device_key: str,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> RuntimeImageReference:
        cancellation.raise_if_cancelled()
        if not device_key:
            raise ValueError("A fake capture requires a device key.")
        if self._scenario.capture_failure:
            raise RuntimeError("Configured fake capture failure.")
        self._capture_generation += 1
        return RuntimeImageReference(
            handle_id=f"fake-image-{self._capture_generation}",
            width=self._scenario.width,
            height=self._scenario.height,
            coordinate_space_id="fake-device-raw",
            generation=self._capture_generation,
            expires_at_monotonic=float("inf"),
        )

    async def recognize_ocr(
        self,
        device_key: str,
        image: RuntimeImageReference,
        roi: RuntimeRect | None,
        confidence_threshold: float,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> RuntimeOcrResult:
        cancellation.raise_if_cancelled()
        if not device_key:
            raise ValueError("A fake OCR operation requires a device key.")
        if not 0 <= confidence_threshold <= 1:
            raise ValueError(
                "The OCR confidence threshold must be between zero and one."
            )
        if roi is not None and (roi.width <= 0 or roi.height <= 0):
            raise ValueError("The OCR region must have positive dimensions.")
        if self._scenario.recognition_failure:
            raise RuntimeError("Configured fake recognition failure.")
        candidates = tuple(
            candidate
            for candidate in self._scenario.candidates
            if candidate.confidence >= confidence_threshold
        )
        return RuntimeOcrResult(
            candidates=candidates,
            matched=bool(candidates),
            source_generation=image.generation,
            source_coordinate_space_id=image.coordinate_space_id,
            operation_id=image.generation,
        )

    async def click_point(
        self,
        device_key: str,
        point: RuntimePoint,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        cancellation.raise_if_cancelled()
        if self._scenario.action_failure:
            raise RuntimeError("Configured fake action failure.")
        self._clicks.append(FakeClickRecord(device_key=device_key, point=point))

    async def click_rect_center(
        self,
        device_key: str,
        rect: RuntimeRect,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        cancellation.raise_if_cancelled()
        if self._scenario.action_failure:
            raise RuntimeError("Configured fake action failure.")
        point = RuntimePoint(
            x=rect.x + rect.width // 2,
            y=rect.y + rect.height // 2,
        )
        self._clicks.append(FakeClickRecord(device_key=device_key, point=point))
        cancellation.raise_if_cancelled()

    async def launch_android_app(
        self,
        device_key: str,
        intent: str,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        cancellation.raise_if_cancelled()
        validated_intent = validate_android_intent(intent)
        if self._scenario.action_failure:
            raise RuntimeError("Configured fake action failure.")
        self._app_launches.append(
            FakeAppLaunchRecord(device_key=device_key, intent=validated_intent)
        )
        cancellation.raise_if_cancelled()

    async def press_android_key(
        self,
        device_key: str,
        key: AndroidKey,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        cancellation.raise_if_cancelled()
        semantic_key = AndroidKey(key)
        key_code = android_key_code(semantic_key)
        if self._scenario.action_failure:
            raise RuntimeError("Configured fake action failure.")
        self._android_keys.append(
            FakeAndroidKeyRecord(
                device_key=device_key,
                key=semantic_key,
                key_code=key_code,
            )
        )
        cancellation.raise_if_cancelled()

    async def long_press(
        self,
        device_key: str,
        point: RuntimePoint,
        duration_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        self._record_touch_action(
            device_key,
            "longPress",
            (point,),
            duration_milliseconds,
            0,
            cancellation,
        )

    async def swipe(
        self,
        device_key: str,
        start: RuntimePoint,
        end: RuntimePoint,
        duration_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        self._record_touch_action(
            device_key,
            "swipe",
            (start, end),
            duration_milliseconds,
            0,
            cancellation,
        )

    async def multi_swipe(
        self,
        device_key: str,
        primary_start: RuntimePoint,
        primary_end: RuntimePoint,
        secondary_start: RuntimePoint,
        secondary_end: RuntimePoint,
        duration_milliseconds: int,
        secondary_start_delay_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        self._record_touch_action(
            device_key,
            "multiSwipe",
            (primary_start, primary_end, secondary_start, secondary_end),
            duration_milliseconds,
            secondary_start_delay_milliseconds,
            cancellation,
        )

    def _record_touch_action(
        self,
        device_key: str,
        action_type: str,
        points: tuple[RuntimePoint, ...],
        duration_milliseconds: int,
        secondary_start_delay_milliseconds: int,
        cancellation: CancellationProbe,
    ) -> None:
        cancellation.raise_if_cancelled()
        if self._scenario.action_failure:
            raise RuntimeError("Configured fake action failure.")
        secondary_delay = secondary_start_delay_milliseconds
        self._touch_actions.append(
            FakeTouchActionRecord(
                device_key=device_key,
                action_type=action_type,
                points=points,
                duration_milliseconds=duration_milliseconds,
                secondary_start_delay_milliseconds=secondary_delay,
            )
        )
        cancellation.raise_if_cancelled()
