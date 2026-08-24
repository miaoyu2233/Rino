"""Deterministic behavior tests for the Phase 4 node executors."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from uuid import UUID

import pytest

import rino_runtime.nodes.builtins as node_builtins
from rino_runtime.backends.base import DeviceServiceError, DeviceServiceErrorCode
from rino_runtime.backends.fake import FakeAutomationBackend, FakeAutomationScenario
from rino_runtime.execution_control import (
    CancellationProbe,
    CancellationScope,
    RuntimeCancellationError,
)
from rino_runtime.nodes import (
    FakeActionRecord,
    InMemoryFakeActionRecorder,
    NodeActivationTiming,
    NodeExecutionContext,
    NodeExecutionFailure,
    NodeExecutionFailureCode,
    NodeExecutionResult,
    RuntimeImageReference,
    RuntimeLogLevel,
    RuntimeOcrCandidate,
    RuntimeOcrResult,
    RuntimePoint,
    RuntimeRect,
    RuntimeValue,
    SuccessorDispatchMode,
    build_maa_backend_registry,
    build_phase_4_fake_backend_registry,
    build_phase_4_production_registry,
    build_phase_4_test_registry,
)
from rino_runtime.nodes.bounded_retry import calculate_bounded_retry_attempts
from rino_runtime.nodes.execution import RuntimeMatchCandidate, RuntimeMatchResult

NODE_ID = UUID("3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f")


def test_bounded_retry_attempt_calculation_accepts_finite_high_frequency_limit() -> (
    None
):
    assert calculate_bounded_retry_attempts(180_000, 10) == 18_000
    assert calculate_bounded_retry_attempts(200_000, 10) == 20_000
    assert calculate_bounded_retry_attempts(200_010, 10) is None


def _image_reference(
    *,
    width: int = 1080,
    height: int = 1920,
) -> RuntimeImageReference:
    return RuntimeImageReference(
        handle_id="image-1",
        width=width,
        height=height,
        coordinate_space_id="device-space-1",
        generation=7,
        expires_at_monotonic=float("inf"),
    )


def _case_catalog() -> dict[str, object]:
    return {
        "taskChoiceCases": [
            {"caseId": "one", "portId": "case1", "label": "One"},
            {"caseId": "two", "portId": "case2", "label": "Two"},
        ]
    }


def _context(
    type_key: str,
    *,
    inputs: Mapping[str, RuntimeValue] | None = None,
    properties: Mapping[str, RuntimeValue] | None = None,
    dynamic_port_state: Mapping[str, object] | None = None,
    device_key: str | None = None,
    project_assets: dict[str, RuntimeImageReference] | None = None,
) -> NodeExecutionContext:
    return NodeExecutionContext(
        node_id=NODE_ID,
        type_key=type_key,
        device_key=device_key,
        inputs=inputs or {},
        properties=properties or {},
        dynamic_port_state=dynamic_port_state or {},
        project_assets=project_assets or {},
    )


async def _execute(
    type_key: str,
    *,
    inputs: Mapping[str, RuntimeValue] | None = None,
    properties: Mapping[str, RuntimeValue] | None = None,
    dynamic_port_state: Mapping[str, object] | None = None,
) -> NodeExecutionResult:
    registry = build_phase_4_production_registry()
    return await registry.execute(
        type_key,
        _context(
            type_key,
            inputs=inputs,
            properties=properties,
            dynamic_port_state=dynamic_port_state,
        ),
    )


@pytest.mark.asyncio
async def test_flow_executors_select_explicit_paths() -> None:
    start = await _execute("core.flow.start")
    sequence = await _execute("core.flow.sequence")
    parallel = await _execute("core.flow.parallel")
    when_true = await _execute("core.logic.branch", inputs={"condition": True})
    when_false = await _execute("core.logic.branch", inputs={"condition": False})
    stop = await _execute("core.flow.stop")
    end_current = await _execute(
        "core.flow.endPath",
        properties={"scope": "current"},
    )
    end_all = await _execute(
        "core.flow.endPath",
        properties={"scope": "all"},
    )

    assert start.selected_execution_outputs == ("next",)
    assert sequence.selected_execution_outputs == (
        "steps",
        *(f"step{index}" for index in range(1, 17)),
    )
    assert parallel.selected_execution_outputs == ("branch1", "branch2")
    assert parallel.successor_dispatch is SuccessorDispatchMode.CONCURRENT
    assert when_true.selected_execution_outputs == ("whenTrue",)
    assert when_false.selected_execution_outputs == ("whenFalse",)
    assert stop.terminal
    assert stop.selected_execution_outputs == ()
    assert not end_current.terminal
    assert end_current.selected_execution_outputs == ()
    assert end_all.terminal
    assert end_all.selected_execution_outputs == ()


@pytest.mark.asyncio
async def test_end_path_rejects_unknown_scope() -> None:
    with pytest.raises(NodeExecutionFailure) as error:
        await _execute(
            "core.flow.endPath",
            properties={"scope": "unknown"},
        )

    assert error.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert error.value.parameters["parameterName"] == "scope"


@pytest.mark.asyncio
async def test_sequence_uses_frozen_authored_order_and_parallel_supports_three() -> (
    None
):
    sequence = await _execute(
        "core.flow.sequence",
        dynamic_port_state={
            "sequenceStepCount": 3,
            "sequenceOrder": ["step3", "step1", "step2"],
        },
    )
    parallel = await _execute(
        "core.flow.parallel",
        dynamic_port_state={"parallelBranchCount": 3},
    )

    assert sequence.selected_execution_outputs == ("step3", "step1", "step2")
    assert parallel.selected_execution_outputs == ("branch1", "branch2", "branch3")
    assert parallel.successor_dispatch is SuccessorDispatchMode.CONCURRENT


@pytest.mark.asyncio
async def test_sequence_order_configuration_outputs_a_typed_tuple() -> None:
    result = await _execute(
        "core.flow.sequenceOrder",
        dynamic_port_state={
            "sequenceStepCount": 3,
            "sequenceOrder": ["step3", "step1", "step2"],
        },
    )

    assert result.outputs == {"order": ("step3", "step1", "step2")}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_state",
    [
        {},
        {"sequenceStepCount": 2, "sequenceOrder": ["step1"]},
        {"sequenceStepCount": 2, "sequenceOrder": ["step1", "step1"]},
        {"sequenceStepCount": 2, "sequenceOrder": ["step1", "step3"]},
    ],
)
async def test_sequence_order_configuration_rejects_bad_dynamic_state(
    bad_state: dict[str, object],
) -> None:
    with pytest.raises(NodeExecutionFailure) as error:
        await _execute("core.flow.sequenceOrder", dynamic_port_state=bad_state)

    assert error.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert error.value.parameters == {"parameterName": "dynamicPortState.sequenceOrder"}


@pytest.mark.asyncio
async def test_sequence_prefers_a_connected_external_order() -> None:
    result = await _execute(
        "core.flow.sequence",
        inputs={"order": ("step2", "step1")},
        dynamic_port_state={
            "sequenceStepCount": 2,
            "sequenceOrder": ["step1", "step2"],
        },
    )

    assert result.selected_execution_outputs == ("step2", "step1")


@pytest.mark.asyncio
async def test_sequence_infers_legacy_step_count_from_external_order() -> None:
    result = await _execute(
        "core.flow.sequence",
        inputs={"order": ("step3", "step1", "step2")},
    )

    assert result.selected_execution_outputs == ("step3", "step1", "step2")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_order",
    [
        ("step1",),
        ("step1", "step1"),
        ("step1", "step3"),
        ("step1", 2),
        ["step1", "step2"],
    ],
)
async def test_sequence_rejects_invalid_external_order(bad_order: object) -> None:
    with pytest.raises(NodeExecutionFailure) as error:
        await _execute(
            "core.flow.sequence",
            inputs={"order": bad_order},  # type: ignore[dict-item]
            dynamic_port_state={"sequenceStepCount": 2},
        )

    assert error.value.code is NodeExecutionFailureCode.INPUT_TYPE_INVALID
    assert error.value.parameters == {"parameterName": "order"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_order",
    [
        ["step1"],
        ["step1", "step1"],
        ["step1", "step3"],
        ["step1", 2],
    ],
)
async def test_sequence_rejects_invalid_authored_order(bad_order: object) -> None:
    with pytest.raises(NodeExecutionFailure) as error:
        await _execute(
            "core.flow.sequence",
            dynamic_port_state={
                "sequenceStepCount": 2,
                "sequenceOrder": bad_order,
            },  # type: ignore[dict-item]
        )

    assert error.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert error.value.parameters == {"parameterName": "dynamicPortState.sequenceOrder"}


@pytest.mark.asyncio
async def test_run_counter_selects_not_reached_then_reached() -> None:
    registry = build_phase_4_production_registry()

    async def execute_at(count: int) -> NodeExecutionResult:
        return await registry.execute(
            "core.flow.runCounter",
            NodeExecutionContext(
                node_id=NODE_ID,
                type_key="core.flow.runCounter",
                inputs={"targetCount": 2},
                activation_timing=NodeActivationTiming(
                    activation_count=count,
                    first_started_at_monotonic=1.0,
                    previous_started_at_monotonic=None,
                    current_started_at_monotonic=float(count),
                ),
            ),
        )

    first = await execute_at(1)
    second = await execute_at(2)

    assert first.outputs == {"currentCount": 1}
    assert first.selected_execution_outputs == ("notReached",)
    assert second.outputs == {"currentCount": 2}
    assert second.selected_execution_outputs == ("reached",)


@pytest.mark.asyncio
async def test_case_overlay_resolves_explicit_fallback_and_missing_image() -> None:
    explicit = await _execute(
        "core.logic.caseOverlayBool",
        inputs={"selectedCaseId": "two", "fallback": False, "case2": True},
        dynamic_port_state=_case_catalog(),
    )
    inherited = await _execute(
        "core.logic.caseOverlayNumber",
        inputs={"selectedCaseId": "two", "fallback": 3.5},
        dynamic_port_state=_case_catalog(),
    )
    missing_image = await _execute(
        "core.logic.caseOverlayImageRef",
        inputs={"selectedCaseId": "two"},
        dynamic_port_state=_case_catalog(),
    )

    assert explicit.outputs == {"value": True}
    assert inherited.outputs == {"value": 3.5}
    assert missing_image.outputs == {}


@pytest.mark.asyncio
async def test_case_overlay_rejects_malformed_unmatched_and_wrong_inputs() -> None:
    cases = _case_catalog()
    with pytest.raises(NodeExecutionFailure) as malformed:
        await _execute(
            "core.logic.caseOverlayBool",
            inputs={"selectedCaseId": "one", "fallback": False},
            dynamic_port_state={"taskChoiceCases": []},
        )
    with pytest.raises(NodeExecutionFailure) as unmatched:
        await _execute(
            "core.logic.caseOverlayBool",
            inputs={"selectedCaseId": "missing", "fallback": False},
            dynamic_port_state=cases,
        )
    with pytest.raises(NodeExecutionFailure) as wrong_type:
        await _execute(
            "core.logic.caseOverlayNumber",
            inputs={"selectedCaseId": "one", "fallback": False},
            dynamic_port_state=cases,
        )

    assert malformed.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert malformed.value.parameters == {"parameterName": "dynamicPortState"}
    assert unmatched.value.code is NodeExecutionFailureCode.INPUT_TYPE_INVALID
    assert unmatched.value.parameters == {"parameterName": "selectedCaseId"}
    assert wrong_type.value.code is NodeExecutionFailureCode.INPUT_TYPE_INVALID
    assert wrong_type.value.parameters == {"parameterName": "fallback"}


class _TemplateRecognitionBackend(FakeAutomationBackend):
    def __init__(self) -> None:
        super().__init__(FakeAutomationScenario())
        self.thresholds: list[float] = []

    async def recognize_template_match(
        self,
        device_key: str,
        image: RuntimeImageReference,
        template: RuntimeImageReference,
        roi: RuntimeRect | None,
        threshold: float,
        method: int,
        green_mask: bool,
        cancellation: object,
        correlation: object | None = None,
    ) -> RuntimeMatchResult:
        self.thresholds.append(threshold)
        return RuntimeMatchResult(
            candidates=(),
            matched=False,
            source_generation=image.generation,
            source_coordinate_space_id=image.coordinate_space_id,
            operation_id=1,
        )


class _ScriptedTemplateRecognitionBackend(FakeAutomationBackend):
    def __init__(self, results: list[RuntimeMatchResult]) -> None:
        super().__init__(FakeAutomationScenario())
        self._results = iter(results)
        self.calls: list[tuple[str, tuple[int, int] | None]] = []

    async def recognize_template_match(
        self,
        device_key: str,
        image: RuntimeImageReference,
        template: RuntimeImageReference,
        roi: RuntimeRect | None,
        threshold: float,
        method: int,
        green_mask: bool,
        cancellation: object,
        correlation: object | None = None,
    ) -> RuntimeMatchResult:
        self.calls.append((template.handle_id, None if roi is None else (roi.x, roi.y)))
        return next(self._results)


class _ScriptedPointBackend(FakeAutomationBackend):
    def __init__(
        self,
        failure_at: int | None = None,
        failure_code: DeviceServiceErrorCode | None = None,
    ) -> None:
        super().__init__(FakeAutomationScenario())
        self.failure_at = failure_at
        self.failure_code = failure_code
        self.attempted_points: list[RuntimePoint] = []

    async def click_point(
        self,
        device_key: str,
        point: RuntimePoint,
        cancellation: object,
        correlation: object | None = None,
    ) -> None:
        self.attempted_points.append(point)
        if self.failure_at == len(self.attempted_points):
            code = self.failure_code
            if code is None:
                raise AssertionError(
                    "A failure code is required for a scripted failure."
                )
            raise DeviceServiceError(
                code,
                "Controlled click failure.",
                retryable=False,
            )
        await super().click_point(device_key, point, cancellation, correlation)


class _CountingLeaseProvider:
    def __init__(self) -> None:
        self.acquisitions = 0
        self.active = 0
        self.maximum_active = 0

    @asynccontextmanager
    async def lease(
        self,
        device_key: str,
        cancellation: CancellationProbe,
    ) -> AsyncIterator[None]:
        del device_key
        cancellation.raise_if_cancelled()
        self.acquisitions += 1
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        try:
            yield
        finally:
            self.active -= 1


@pytest.mark.asyncio
async def test_template_matching_stops_on_first_image_region_hit() -> None:
    hit_rect = RuntimeRect(30, 40, 20, 10, "device-space-1", 7)
    unmatched = RuntimeMatchResult(
        candidates=(),
        matched=False,
        source_generation=7,
        source_coordinate_space_id="device-space-1",
        operation_id=1,
    )
    matched = RuntimeMatchResult(
        candidates=(RuntimeMatchCandidate(0.91, hit_rect),),
        matched=True,
        source_generation=7,
        source_coordinate_space_id="device-space-1",
        operation_id=3,
    )
    backend = _ScriptedTemplateRecognitionBackend(
        [unmatched, unmatched, matched, unmatched]
    )
    registry = build_maa_backend_registry(backend, include_ocr=False)
    image = _image_reference()
    templates = (
        RuntimeImageReference("template-1", 20, 20, "device-space-1", 7, float("inf")),
        RuntimeImageReference("template-2", 20, 20, "device-space-1", 7, float("inf")),
    )
    regions = (
        RuntimeRect(1, 2, 100, 100, "device-space-1", 7),
        RuntimeRect(3, 4, 100, 100, "device-space-1", 7),
    )

    result = await registry.execute(
        "vision.templateMatch",
        _context(
            "vision.templateMatch",
            inputs={
                "image": image,
                "templates": templates,
                "regions": regions,
            },
            properties={
                "threshold": 0.7,
                "method": "normalizedCoefficient",
                "greenMask": False,
            },
            device_key="device-opaque",
        ),
    )

    assert backend.calls == [
        ("template-1", (1, 2)),
        ("template-1", (3, 4)),
        ("template-2", (1, 2)),
    ]
    assert result.outputs["matchedTemplateIndex"] == 2
    assert result.outputs["matchedRegionIndex"] == 1
    assert result.outputs["matchedTemplate"] == templates[1]
    assert result.outputs["bestRect"] == hit_rect
    assert result.selected_execution_outputs == ("next",)


@pytest.mark.asyncio
async def test_template_threshold_input_precedes_property_and_keeps_bounds() -> None:
    backend = _TemplateRecognitionBackend()
    registry = build_maa_backend_registry(backend, include_ocr=False)
    common = {
        "image": _image_reference(),
        "template": _image_reference(),
    }
    await registry.execute(
        "vision.templateMatch",
        _context(
            "vision.templateMatch",
            inputs={**common, "threshold": 0.25},
            properties={
                "threshold": 0.8,
                "method": "normalizedCoefficient",
                "greenMask": False,
            },
            device_key="device-opaque",
        ),
    )
    await registry.execute(
        "vision.templateMatch",
        _context(
            "vision.templateMatch",
            inputs=common,
            properties={
                "threshold": 0.8,
                "method": "normalizedCoefficient",
                "greenMask": False,
            },
            device_key="device-opaque",
        ),
    )

    assert backend.thresholds == [0.25, 0.8]

    with pytest.raises(NodeExecutionFailure) as failure:
        await registry.execute(
            "vision.templateMatch",
            _context(
                "vision.templateMatch",
                inputs={**common, "threshold": 1.1},
                properties={
                    "threshold": 0.8,
                    "method": "normalizedCoefficient",
                    "greenMask": False,
                },
                device_key="device-opaque",
            ),
        )
    assert failure.value.code is NodeExecutionFailureCode.PROPERTY_INVALID


class _OcrThresholdBackend(FakeAutomationBackend):
    def __init__(self) -> None:
        super().__init__(FakeAutomationScenario())
        self.thresholds: list[float] = []

    async def recognize_ocr(
        self,
        device_key: str,
        image: RuntimeImageReference,
        roi: RuntimeRect | None,
        confidence_threshold: float,
        cancellation: object,
        correlation: object | None = None,
    ) -> RuntimeOcrResult:
        self.thresholds.append(confidence_threshold)
        return RuntimeOcrResult(
            candidates=(),
            matched=False,
            source_generation=image.generation,
            source_coordinate_space_id=image.coordinate_space_id,
            operation_id=1,
        )


class _ScriptedOcrBackend(FakeAutomationBackend):
    def __init__(self, results: list[RuntimeOcrResult]) -> None:
        super().__init__(FakeAutomationScenario())
        self._results = iter(results)
        self.regions: list[tuple[int, int] | None] = []

    async def recognize_ocr(
        self,
        device_key: str,
        image: RuntimeImageReference,
        roi: RuntimeRect | None,
        confidence_threshold: float,
        cancellation: object,
        correlation: object | None = None,
    ) -> RuntimeOcrResult:
        self.regions.append(None if roi is None else (roi.x, roi.y))
        return next(self._results)


@pytest.mark.asyncio
async def test_ocr_matching_tries_regions_in_order_and_stops_on_first_hit() -> None:
    candidate = RuntimeOcrCandidate(
        "ready",
        0.88,
        RuntimeRect(50, 60, 20, 10, "device-space-1", 7),
    )
    unmatched = RuntimeOcrResult(
        candidates=(),
        matched=False,
        source_generation=7,
        source_coordinate_space_id="device-space-1",
        operation_id=1,
    )
    matched = RuntimeOcrResult(
        candidates=(candidate,),
        matched=True,
        source_generation=7,
        source_coordinate_space_id="device-space-1",
        operation_id=2,
    )
    backend = _ScriptedOcrBackend([unmatched, matched, unmatched])
    registry = build_maa_backend_registry(backend, include_ocr=True)
    regions = (
        RuntimeRect(1, 2, 100, 100, "device-space-1", 7),
        RuntimeRect(3, 4, 100, 100, "device-space-1", 7),
        RuntimeRect(5, 6, 100, 100, "device-space-1", 7),
    )

    result = await registry.execute(
        "vision.ocr",
        _context(
            "vision.ocr",
            inputs={"image": _image_reference(), "regions": regions},
            properties={"confidenceThreshold": 0.7, "expected": []},
            device_key="device-opaque",
        ),
    )

    assert backend.regions == [(1, 2), (3, 4)]
    assert result.outputs["matchedRegionIndex"] == 2
    assert result.outputs["bestConfidence"] == pytest.approx(0.88)
    assert result.outputs["bestRect"] == candidate.rect


@pytest.mark.asyncio
async def test_ocr_threshold_input_precedes_property_and_keeps_bounds() -> None:
    backend = _OcrThresholdBackend()
    registry = build_maa_backend_registry(backend, include_ocr=True)
    common = {"image": _image_reference()}
    await registry.execute(
        "vision.ocr",
        _context(
            "vision.ocr",
            inputs={**common, "confidenceThreshold": 0.25},
            properties={"confidenceThreshold": 0.8, "expected": []},
            device_key="device-opaque",
        ),
    )
    await registry.execute(
        "vision.ocr",
        _context(
            "vision.ocr",
            inputs=common,
            properties={"confidenceThreshold": 0.8, "expected": []},
            device_key="device-opaque",
        ),
    )
    assert backend.thresholds == [0.25, 0.8]

    with pytest.raises(NodeExecutionFailure) as failure:
        await registry.execute(
            "vision.ocr",
            _context(
                "vision.ocr",
                inputs={**common, "confidenceThreshold": 1.1},
                properties={"confidenceThreshold": 0.8, "expected": []},
                device_key="device-opaque",
            ),
        )
    assert failure.value.code is NodeExecutionFailureCode.PROPERTY_INVALID


@pytest.mark.asyncio
async def test_click_rect_offsets_use_inputs_before_properties() -> None:
    backend = FakeAutomationBackend(FakeAutomationScenario())
    registry = build_phase_4_fake_backend_registry(backend)
    rect = RuntimeRect(10, 20, 100, 80, "device-space-1", 7)
    properties = {
        "offsetX": 2,
        "offsetY": 3,
        "offsetWidth": 4,
        "offsetHeight": 5,
    }

    await registry.execute(
        "automation.clickRectCenter",
        _context(
            "automation.clickRectCenter",
            inputs={
                "rect": rect,
                "offsetX": 5,
                "offsetY": -3,
                "offsetWidth": 10,
                "offsetHeight": -2,
            },
            properties=properties,
            device_key="device-opaque",
        ),
    )
    await registry.execute(
        "automation.clickRectCenter",
        _context(
            "automation.clickRectCenter",
            inputs={"rect": rect},
            properties=properties,
            device_key="device-opaque",
        ),
    )

    assert [record.point for record in backend.clicks] == [
        RuntimePoint(70, 56),
        RuntimePoint(64, 65),
    ]


@pytest.mark.asyncio
async def test_click_point_preserves_legacy_point_and_coordinates_modes() -> None:
    backend = _ScriptedPointBackend()
    registry = build_phase_4_fake_backend_registry(backend)
    point = RuntimePoint(11, 22, "device-space-1", 7)

    point_result = await registry.execute(
        "automation.clickPoint",
        _context(
            "automation.clickPoint",
            inputs={"point": point},
            properties={"inputMode": "point"},
            device_key="device-opaque",
        ),
    )
    coordinates_result = await registry.execute(
        "automation.clickPoint",
        _context(
            "automation.clickPoint",
            inputs={
                "image": _image_reference(),
                "x": 120,
                "y": 340,
                "referenceWidth": 1080,
                "referenceHeight": 1920,
            },
            properties={"inputMode": "coordinates"},
            device_key="device-opaque",
        ),
    )

    assert point_result.outputs == {
        "clicked": True,
        "clickedCount": 1,
        "selectedIndex": 1,
    }
    assert coordinates_result.outputs == {
        "clicked": True,
        "clickedCount": 1,
        "selectedIndex": 1,
    }
    assert backend.attempted_points == [
        point,
        RuntimePoint(120, 340, "device-space-1", 7),
    ]


@pytest.mark.asyncio
async def test_click_point_random_mode_reports_one_based_selected_index(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(node_builtins, "_random_index", lambda length: 1)
    backend = _ScriptedPointBackend()
    registry = build_phase_4_fake_backend_registry(backend)
    points = (
        RuntimePoint(10, 20),
        RuntimePoint(30, 40),
        RuntimePoint(50, 60),
    )

    result = await registry.execute(
        "automation.clickPoint",
        _context(
            "automation.clickPoint",
            inputs={"points": points},
            properties={"inputMode": "randomPoints"},
            device_key="device-opaque",
        ),
    )

    assert result.outputs == {
        "clicked": True,
        "clickedCount": 1,
        "selectedIndex": 2,
    }
    assert backend.attempted_points == [points[1]]


@pytest.mark.asyncio
async def test_click_point_sequential_mode_uses_one_lease_and_no_final_delay(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    delay_calls: list[float] = []

    async def record_delay(
        duration_seconds: float,
        cancellation: CancellationProbe,
    ) -> None:
        cancellation.raise_if_cancelled()
        delay_calls.append(duration_seconds)

    monkeypatch.setattr(node_builtins, "cancellable_delay", record_delay)
    backend = _ScriptedPointBackend()
    lease_provider = _CountingLeaseProvider()
    registry = build_phase_4_fake_backend_registry(
        backend,
        lease_provider=lease_provider,
    )
    points = (
        RuntimePoint(10, 20),
        RuntimePoint(30, 40),
        RuntimePoint(50, 60),
    )

    result = await registry.execute(
        "automation.clickPoint",
        _context(
            "automation.clickPoint",
            inputs={"points": points},
            properties={"inputMode": "sequentialPoints"},
            device_key="device-opaque",
        ),
    )

    assert result.outputs == {
        "clicked": True,
        "clickedCount": 3,
        "selectedIndex": 0,
    }
    assert backend.attempted_points == list(points)
    assert delay_calls == [0.1, 0.1]
    assert lease_provider.acquisitions == 1
    assert lease_provider.maximum_active == 1
    assert lease_provider.active == 0


@pytest.mark.asyncio
async def test_click_point_rectangle_modes_preserve_metadata_and_pixel_bounds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(node_builtins, "_random_index", lambda length: 1)
    backend = _ScriptedPointBackend()
    registry = build_phase_4_fake_backend_registry(backend)
    rect = RuntimeRect(10, 20, 4, 6, "device-space-1", 7)

    await registry.execute(
        "automation.clickPoint",
        _context(
            "automation.clickPoint",
            inputs={"rect": rect},
            properties={"inputMode": "rectCenter"},
            device_key="device-opaque",
        ),
    )
    await registry.execute(
        "automation.clickPoint",
        _context(
            "automation.clickPoint",
            inputs={"rect": rect},
            properties={"inputMode": "rectRandom"},
            device_key="device-opaque",
        ),
    )

    assert backend.attempted_points == [
        RuntimePoint(12, 23, "device-space-1", 7),
        RuntimePoint(11, 21, "device-space-1", 7),
    ]
    assert 10 <= backend.attempted_points[1].x < 14
    assert 20 <= backend.attempted_points[1].y < 26


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "points",
    (
        (),
        tuple(RuntimePoint(index, index) for index in range(17)),
        (RuntimePoint(1, 2), "not-a-point"),
    ),
)
async def test_click_point_rejects_invalid_point_collections(
    points: RuntimeValue,
) -> None:
    backend = _ScriptedPointBackend()
    registry = build_phase_4_fake_backend_registry(backend)

    with pytest.raises(NodeExecutionFailure) as failure:
        await registry.execute(
            "automation.clickPoint",
            _context(
                "automation.clickPoint",
                inputs={"points": points},
                properties={"inputMode": "randomPoints"},
                device_key="device-opaque",
            ),
        )

    assert failure.value.code is NodeExecutionFailureCode.INPUT_TYPE_INVALID
    assert backend.attempted_points == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rect",
    (
        RuntimeRect(-1, 0, 1, 1),
        RuntimeRect(0, -1, 1, 1),
        RuntimeRect(0, 0, 0, 1),
        RuntimeRect(0, 0, 1, 0),
        RuntimeRect(0.5, 0, 1, 1),  # type: ignore[arg-type]
    ),
)
async def test_click_point_rejects_invalid_rectangles(rect: RuntimeRect) -> None:
    backend = _ScriptedPointBackend()
    registry = build_phase_4_fake_backend_registry(backend)

    with pytest.raises(NodeExecutionFailure) as failure:
        await registry.execute(
            "automation.clickPoint",
            _context(
                "automation.clickPoint",
                inputs={"rect": rect},
                properties={"inputMode": "rectCenter"},
                device_key="device-opaque",
            ),
        )

    assert failure.value.code is NodeExecutionFailureCode.INPUT_TYPE_INVALID
    assert backend.attempted_points == []


@pytest.mark.asyncio
@pytest.mark.parametrize("interval", (-1, 60_001, 100.5, True))
async def test_click_point_rejects_invalid_sequential_interval(
    interval: RuntimeValue,
) -> None:
    backend = _ScriptedPointBackend()
    registry = build_phase_4_fake_backend_registry(backend)

    with pytest.raises(NodeExecutionFailure) as failure:
        await registry.execute(
            "automation.clickPoint",
            _context(
                "automation.clickPoint",
                inputs={"points": (RuntimePoint(1, 2),)},
                properties={
                    "inputMode": "sequentialPoints",
                    "intervalMilliseconds": interval,
                },
                device_key="device-opaque",
            ),
        )

    assert failure.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert backend.attempted_points == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("failure_code", "node_code", "can_follow_failure_output"),
    (
        (
            DeviceServiceErrorCode.ACTION_OUTCOME_UNKNOWN,
            NodeExecutionFailureCode.ACTION_OUTCOME_UNKNOWN,
            False,
        ),
        (
            DeviceServiceErrorCode.ACTION_REJECTED,
            NodeExecutionFailureCode.ACTION_FAILED,
            True,
        ),
    ),
)
async def test_click_point_stops_after_device_failure_without_retry(
    failure_code: DeviceServiceErrorCode,
    node_code: NodeExecutionFailureCode,
    can_follow_failure_output: bool,
) -> None:
    points = (
        RuntimePoint(10, 20),
        RuntimePoint(30, 40),
        RuntimePoint(50, 60),
    )
    backend = _ScriptedPointBackend(failure_at=2, failure_code=failure_code)
    registry = build_phase_4_fake_backend_registry(backend)

    with pytest.raises(NodeExecutionFailure) as failure:
        await registry.execute(
            "automation.clickPoint",
            _context(
                "automation.clickPoint",
                inputs={"points": points},
                properties={"inputMode": "sequentialPoints"},
                device_key="device-opaque",
            ),
        )

    assert failure.value.code is node_code
    assert failure.value.can_follow_failure_output is can_follow_failure_output
    assert backend.attempted_points == [points[0], points[1]]


@pytest.mark.asyncio
async def test_bounded_retry_selects_attempt_then_exhausts_at_deadline() -> None:
    registry = build_phase_4_production_registry()
    properties: dict[str, RuntimeValue] = {
        "timeoutMilliseconds": 20_000,
        "rateLimitMilliseconds": 1_000,
        "maximumAttempts": 20,
    }
    first = await registry.execute(
        "core.flow.boundedRetry",
        NodeExecutionContext(
            node_id=NODE_ID,
            type_key="core.flow.boundedRetry",
            properties=properties,
            activation_timing=NodeActivationTiming(
                activation_count=1,
                first_started_at_monotonic=80.0,
                previous_started_at_monotonic=None,
                current_started_at_monotonic=80.0,
            ),
            monotonic_now=lambda: 80.0,
        ),
    )
    exhausted = await registry.execute(
        "core.flow.boundedRetry",
        NodeExecutionContext(
            node_id=NODE_ID,
            type_key="core.flow.boundedRetry",
            properties=properties,
            activation_timing=NodeActivationTiming(
                activation_count=21,
                first_started_at_monotonic=80.0,
                previous_started_at_monotonic=99.0,
                current_started_at_monotonic=100.0,
            ),
            monotonic_now=lambda: 100.0,
        ),
    )

    assert first.selected_execution_outputs == ("attempt",)
    assert first.outputs == {"attemptNumber": 1, "elapsedMilliseconds": 0.0}
    assert exhausted.selected_execution_outputs == ("exhausted",)
    assert exhausted.outputs == {
        "attemptNumber": 20,
        "elapsedMilliseconds": 20_000.0,
    }


@pytest.mark.asyncio
async def test_bounded_retry_rejects_invalid_attempt_bound() -> None:
    with pytest.raises(NodeExecutionFailure) as failure:
        await build_phase_4_production_registry().execute(
            "core.flow.boundedRetry",
            NodeExecutionContext(
                node_id=NODE_ID,
                type_key="core.flow.boundedRetry",
                properties={
                    "timeoutMilliseconds": 20_000,
                    "rateLimitMilliseconds": 1_000,
                    "maximumAttempts": 0,
                },
                activation_timing=NodeActivationTiming(
                    activation_count=1,
                    first_started_at_monotonic=1.0,
                    previous_started_at_monotonic=None,
                    current_started_at_monotonic=1.0,
                ),
                monotonic_now=lambda: 1.0,
            ),
        )

    assert failure.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert failure.value.parameters == {"parameterName": "maximumAttempts"}


@pytest.mark.asyncio
async def test_bounded_retry_rejects_timeout_above_long_run_bound() -> None:
    with pytest.raises(NodeExecutionFailure) as failure:
        await build_phase_4_production_registry().execute(
            "core.flow.boundedRetry",
            NodeExecutionContext(
                node_id=NODE_ID,
                type_key="core.flow.boundedRetry",
                properties={
                    "timeoutMilliseconds": 18_000_001,
                    "rateLimitMilliseconds": 1_000,
                    "maximumAttempts": 20,
                },
                activation_timing=NodeActivationTiming(
                    activation_count=1,
                    first_started_at_monotonic=1.0,
                    previous_started_at_monotonic=None,
                    current_started_at_monotonic=1.0,
                ),
                monotonic_now=lambda: 1.0,
            ),
        )

    assert failure.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert failure.value.parameters == {"parameterName": "timeoutMilliseconds"}


@pytest.mark.asyncio
async def test_bounded_retry_rate_wait_is_cancellable() -> None:
    scope = CancellationScope()
    started_at = time.monotonic()
    retry_task = asyncio.create_task(
        build_phase_4_production_registry().execute(
            "core.flow.boundedRetry",
            NodeExecutionContext(
                node_id=NODE_ID,
                type_key="core.flow.boundedRetry",
                properties={
                    "timeoutMilliseconds": 60_000,
                    "rateLimitMilliseconds": 60_000,
                    "maximumAttempts": 2,
                },
                cancellation=scope,
                activation_timing=NodeActivationTiming(
                    activation_count=2,
                    first_started_at_monotonic=started_at,
                    previous_started_at_monotonic=started_at,
                    current_started_at_monotonic=started_at,
                ),
            ),
        )
    )
    await asyncio.sleep(0)

    scope.cancel()

    with pytest.raises(RuntimeCancellationError):
        await asyncio.wait_for(retry_task, timeout=0.5)


@pytest.mark.asyncio
async def test_task_choice_selects_known_case_and_routes_stale_case_to_unmatched() -> (
    None
):
    dynamic_port_state: dict[str, object] = {
        "taskChoiceCases": [
            {"caseId": "gold", "portId": "case1", "label": "刷金币"},
            {"caseId": "diamond", "portId": "case2", "label": "刷钻石"},
        ]
    }

    known = await _execute(
        "core.logic.taskChoice",
        properties={"selectedCaseId": "gold"},
        dynamic_port_state=dynamic_port_state,
    )
    stale = await _execute(
        "core.logic.taskChoice",
        properties={"selectedCaseId": "removed"},
        dynamic_port_state=dynamic_port_state,
    )

    assert known.outputs == {"selectedCaseId": "gold"}
    assert known.selected_execution_outputs == ("case1",)
    assert stale.outputs == {"selectedCaseId": "removed"}
    assert stale.selected_execution_outputs == ("unmatched",)


@pytest.mark.asyncio
async def test_task_choice_rejects_malformed_dynamic_state() -> None:
    with pytest.raises(NodeExecutionFailure) as failure:
        await _execute(
            "core.logic.taskChoice",
            properties={"selectedCaseId": "gold"},
            dynamic_port_state={"taskChoiceCases": [{"caseId": "bad id"}]},
        )

    assert failure.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert failure.value.parameters == {"parameterName": "dynamicPortState"}


@pytest.mark.asyncio
async def test_project_image_asset_returns_only_prepared_runtime_reference() -> None:
    asset_id = "01234567-89ab-4cde-8f01-23456789abcd"
    reference = _image_reference()
    registry = build_phase_4_production_registry()

    result = await registry.execute(
        "core.image.projectAsset",
        _context(
            "core.image.projectAsset",
            properties={"assetId": asset_id},
            project_assets={asset_id: reference},
        ),
    )

    assert result.outputs == {"image": reference}
    with pytest.raises(NodeExecutionFailure) as raised:
        await registry.execute(
            "core.image.projectAsset",
            _context(
                "core.image.projectAsset",
                properties={"assetId": asset_id},
            ),
        )
    assert raised.value.code is NodeExecutionFailureCode.PROJECT_ASSET_UNAVAILABLE


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("operator", "expected"),
    [
        ("greaterThan", True),
        ("greaterThanOrEqual", True),
        ("lessThan", False),
        ("lessThanOrEqual", False),
        ("equalTo", False),
        ("notEqualTo", True),
    ],
)
async def test_number_comparison_operators(operator: str, expected: bool) -> None:
    result = await _execute(
        "core.logic.numberCompare",
        inputs={"left": 5, "right": 3},
        properties={"operator": operator},
    )

    assert result.outputs == {"result": expected, "relation": "greaterThan"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("operator", "expected"),
    [
        ("add", 8),
        ("subtract", 2),
        ("multiply", 15),
        ("divide", 5 / 3),
    ],
)
async def test_arithmetic_operators(operator: str, expected: float) -> None:
    result = await _execute(
        "core.math.arithmetic",
        inputs={"left": 5, "right": 3},
        properties={"operator": operator},
    )

    assert result.outputs["result"] == pytest.approx(expected)


@pytest.mark.asyncio
async def test_arithmetic_rejects_division_by_zero() -> None:
    with pytest.raises(NodeExecutionFailure) as failure:
        await _execute(
            "core.math.arithmetic",
            inputs={"left": 5, "right": 0},
            properties={"operator": "divide"},
        )

    assert failure.value.code is NodeExecutionFailureCode.INPUT_TYPE_INVALID
    assert failure.value.parameters == {"parameterName": "right"}


@pytest.mark.asyncio
async def test_numeric_expression_supports_authored_variables_and_parentheses() -> None:
    result = await _execute(
        "core.math.expression",
        inputs={"a": 7, "b": 5, "c": 2},
        properties={"expression": "(a + b) / c"},
        dynamic_port_state={"numericInputCount": 3},
    )

    assert result.outputs == {"result": 6.0}


@pytest.mark.asyncio
async def test_number_select_returns_first_input_name_for_ties() -> None:
    result = await _execute(
        "core.logic.numberSelect",
        inputs={"a": 8, "b": 8, "c": 3},
        properties={"mode": "maximum"},
        dynamic_port_state={"numericInputCount": 3},
    )

    assert result.outputs == {"value": 8.0, "condition": "a"}


@pytest.mark.asyncio
async def test_read_nodes_select_spatial_candidate_and_parse_number() -> None:
    candidates = (
        RuntimeOcrCandidate("22", 0.8, RuntimeRect(100, 100, 20, 10)),
        RuntimeOcrCandidate("11", 0.9, RuntimeRect(10, 102, 20, 10)),
        RuntimeOcrCandidate("33", 0.7, RuntimeRect(12, 200, 20, 10)),
    )
    result = RuntimeOcrResult(candidates, True, 1, "space", 7)
    selection_properties: dict[str, RuntimeValue] = {
        "candidateIndex": 2,
        "readingOrder": "rowMajor",
    }

    text_result = await _execute(
        "text.readText",
        inputs={"result": result},
        properties=selection_properties,
    )
    number_result = await _execute(
        "text.readNumber",
        inputs={"result": result},
        properties={
            **selection_properties,
            "decimalSeparator": ".",
            "groupingSeparator": ",",
            "normalizeFullWidth": False,
            "allowSign": True,
        },
    )
    column_result = await _execute(
        "text.readText",
        inputs={"result": result},
        properties={"candidateIndex": 2, "readingOrder": "columnMajor"},
    )

    assert text_result.outputs["text"] == "22"
    assert text_result.selected_execution_outputs == ("selected",)
    assert number_result.outputs["number"] == 22
    assert number_result.selected_execution_outputs == ("selected",)
    assert column_result.outputs["text"] == "33"


@pytest.mark.asyncio
async def test_read_nodes_distinguish_missing_and_invalid_number() -> None:
    result = RuntimeOcrResult(
        (RuntimeOcrCandidate("not a number", 0.8, RuntimeRect(10, 10, 20, 10)),),
        True,
        1,
        "space",
        7,
    )
    format_properties: dict[str, RuntimeValue] = {
        "readingOrder": "columnMajor",
        "decimalSeparator": ".",
        "groupingSeparator": ",",
        "normalizeFullWidth": False,
        "allowSign": True,
    }
    missing = await _execute(
        "text.readText",
        inputs={"result": result},
        properties={"candidateIndex": 2, "readingOrder": "rowMajor"},
    )
    invalid = await _execute(
        "text.readNumber",
        inputs={"result": result},
        properties={**format_properties, "candidateIndex": 1},
    )

    assert missing.selected_execution_outputs == ("missing",)
    assert invalid.selected_execution_outputs == ("invalid",)


def _read_value_properties(**overrides: RuntimeValue) -> dict[str, RuntimeValue]:
    properties: dict[str, RuntimeValue] = {
        "valueMode": "number",
        "numberType": "float",
        "selectionMode": "position",
        "readingOrder": "rowMajor",
        "lineIndex": 1,
        "itemIndex": 1,
        "decimalSeparator": ".",
        "groupingSeparator": ",",
        "normalizeFullWidth": False,
        "allowSign": True,
    }
    properties.update(overrides)
    return properties


@pytest.mark.asyncio
async def test_read_value_groups_text_by_line_and_item_in_both_orders() -> None:
    candidates = (
        RuntimeOcrCandidate("A", 0.9, RuntimeRect(10, 10, 20, 10)),
        RuntimeOcrCandidate("B", 0.9, RuntimeRect(50, 12, 20, 10)),
        RuntimeOcrCandidate("C", 0.9, RuntimeRect(10, 50, 20, 10)),
    )
    result = RuntimeOcrResult(candidates, True, 1, "space", 7)

    all_text = await _execute(
        "text.readValue",
        inputs={"result": result},
        properties=_read_value_properties(
            valueMode="text",
            selectionMode="all",
        ),
    )
    row_position = await _execute(
        "text.readValue",
        inputs={"result": result},
        properties=_read_value_properties(
            valueMode="text",
            lineIndex=2,
            itemIndex=1,
        ),
    )
    column_position = await _execute(
        "text.readValue",
        inputs={"result": result},
        properties=_read_value_properties(
            valueMode="text",
            lineIndex=2,
            itemIndex=1,
            readingOrder="columnMajor",
        ),
    )

    assert all_text.outputs["texts"] == ("A", "B", "C")
    assert all_text.outputs["rects"] == tuple(
        candidate.rect for candidate in candidates
    )
    assert row_position.outputs == {"text": "C", "rect": candidates[2].rect}
    assert column_position.outputs == {"text": "B", "rect": candidates[1].rect}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("number_type", "text", "expected"),
    [
        ("integer", "12", 12.0),
        ("float", "12.5", 12.5),
        ("percentage", "42%", 0.42),
        ("positive", "3", 3.0),
        ("unsignedInteger", "3", 3.0),
    ],
)
async def test_read_value_parses_number_types(
    number_type: str,
    text: str,
    expected: float,
) -> None:
    result = RuntimeOcrResult(
        (RuntimeOcrCandidate(text, 0.9, RuntimeRect(10, 10, 20, 10)),),
        True,
        1,
        "space",
        7,
    )

    parsed = await _execute(
        "text.readValue",
        inputs={"result": result},
        properties=_read_value_properties(numberType=number_type),
    )

    assert parsed.outputs["number"] == pytest.approx(expected)
    assert parsed.selected_execution_outputs == ("selected",)


@pytest.mark.asyncio
async def test_read_value_filters_mixed_text_in_number_all_mode() -> None:
    candidates = (
        RuntimeOcrCandidate("1", 0.9, RuntimeRect(10, 10, 20, 10)),
        RuntimeOcrCandidate("not numeric", 0.9, RuntimeRect(40, 10, 20, 10)),
        RuntimeOcrCandidate("2.5", 0.9, RuntimeRect(70, 10, 20, 10)),
    )
    result = RuntimeOcrResult(candidates, True, 1, "space", 7)

    parsed = await _execute(
        "text.readValue",
        inputs={"result": result},
        properties=_read_value_properties(selectionMode="all"),
    )

    assert parsed.outputs["numbers"] == (1.0, 2.5)
    assert parsed.outputs["rects"] == (candidates[0].rect, candidates[2].rect)
    assert parsed.selected_execution_outputs == ("selected",)


@pytest.mark.asyncio
async def test_read_value_distinguishes_missing_and_invalid_results() -> None:
    unmatched = RuntimeOcrResult((), False, 1, "space", 7)
    invalid = RuntimeOcrResult(
        (RuntimeOcrCandidate("not numeric", 0.9, RuntimeRect(10, 10, 20, 10)),),
        True,
        1,
        "space",
        7,
    )

    missing = await _execute(
        "text.readValue",
        inputs={"result": unmatched},
        properties=_read_value_properties(),
    )
    invalid_result = await _execute(
        "text.readValue",
        inputs={"result": invalid},
        properties=_read_value_properties(),
    )

    assert missing.outputs == {}
    assert missing.selected_execution_outputs == ("missing",)
    assert invalid_result.outputs == {}
    assert invalid_result.selected_execution_outputs == ("invalid",)


def test_read_value_definition_has_contract_defaults() -> None:
    definition = build_phase_4_production_registry().definition("text.readValue")

    assert definition is not None
    assert definition.property_defaults is not None
    assert json.loads(definition.property_defaults.model_dump_json()) == {
        "valueMode": "number",
        "numberType": "float",
        "selectionMode": "position",
        "readingOrder": "rowMajor",
        "lineIndex": 1,
        "itemIndex": 1,
        "decimalSeparator": ".",
        "groupingSeparator": ",",
        "normalizeFullWidth": False,
        "allowSign": True,
    }


@pytest.mark.asyncio
async def test_literal_delay_and_log_executors() -> None:
    number = await _execute("core.value.numberLiteral", properties={"value": 12.5})
    string = await _execute("core.value.stringLiteral", properties={"value": "hello"})
    delay = await _execute("core.time.delay", inputs={"durationMilliseconds": 0})
    log = await _execute("core.diagnostic.log", inputs={"message": "value=12.5"})

    assert number.outputs == {"value": 12.5}
    assert string.outputs == {"value": "hello"}
    assert delay.selected_execution_outputs == ("next",)
    assert log.selected_execution_outputs == ("next",)
    assert len(log.logs) == 1
    assert log.logs[0].level is RuntimeLogLevel.INFO
    assert log.logs[0].message == "value=12.5"


@pytest.mark.asyncio
async def test_explicit_android_actions_use_narrow_backend_operations() -> None:
    backend = FakeAutomationBackend(FakeAutomationScenario())
    registry = build_phase_4_fake_backend_registry(backend)
    device_key = "device-opaque"

    launch = await registry.execute(
        "automation.launchAndroidApp",
        _context(
            "automation.launchAndroidApp",
            properties={"intent": "com.example.game/.MainActivity"},
            device_key=device_key,
        ),
    )
    key = await registry.execute(
        "automation.pressAndroidKey",
        _context(
            "automation.pressAndroidKey",
            properties={"key": "escape"},
            device_key=device_key,
        ),
    )
    swipe = await registry.execute(
        "automation.swipe",
        _context(
            "automation.swipe",
            inputs={"start": RuntimePoint(20, 30), "end": RuntimePoint(80, 90)},
            properties={"durationMilliseconds": 250},
            device_key=device_key,
        ),
    )

    assert launch.outputs == {"launched": True}
    assert key.outputs == {"pressed": True}
    assert swipe.outputs == {"completed": True}
    assert backend.app_launches[0].intent == "com.example.game/.MainActivity"
    assert backend.android_keys[0].key_code == 111
    assert backend.touch_actions[0].points == (
        RuntimePoint(20, 30),
        RuntimePoint(80, 90),
    )
    assert backend.touch_actions[0].duration_milliseconds == 250


@pytest.mark.asyncio
async def test_launch_node_rejects_command_like_intents_before_dispatch() -> None:
    backend = FakeAutomationBackend(FakeAutomationScenario())
    registry = build_phase_4_fake_backend_registry(backend)

    with pytest.raises(NodeExecutionFailure) as failure:
        await registry.execute(
            "automation.launchAndroidApp",
            _context(
                "automation.launchAndroidApp",
                properties={"intent": "com.example.game;input keyevent 111"},
                device_key="device-opaque",
            ),
        )

    assert failure.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert failure.value.parameters == {"parameterName": "intent"}
    assert backend.app_launches == ()


@pytest.mark.asyncio
async def test_log_executor_joins_typed_segments_and_appends_one_newline() -> None:
    result = await _execute(
        "core.diagnostic.log",
        inputs={
            "textPart1": "score=",
            "numberPart2": 12.5,
            "textPart3": ",ready",
        },
        properties={
            "segmentKinds": ("text", "number", "text"),
            "appendNewline": True,
        },
    )

    assert result.selected_execution_outputs == ("next",)
    assert len(result.logs) == 1
    assert result.logs[0].message == "score=12.5,ready\n"


@pytest.mark.asyncio
async def test_geometry_nodes_bind_authoring_values_to_the_current_image() -> None:
    image = _image_reference()
    point = await _execute(
        "core.geometry.point",
        inputs={
            "image": image,
            "x": 120,
            "y": 340,
            "referenceWidth": 1080,
            "referenceHeight": 1920,
        },
    )
    rectangle = await _execute(
        "core.geometry.rectangle",
        inputs={
            "image": image,
            "x": 100,
            "y": 200,
            "width": 300,
            "height": 400,
            "referenceWidth": 1080,
            "referenceHeight": 1920,
        },
    )

    assert point.outputs == {"point": RuntimePoint(120, 340, "device-space-1", 7)}
    assert rectangle.outputs == {
        "rectangle": RuntimeRect(100, 200, 300, 400, "device-space-1", 7)
    }


@pytest.mark.asyncio
async def test_geometry_nodes_reject_resolution_mismatch_before_binding() -> None:
    with pytest.raises(NodeExecutionFailure) as failure:
        await _execute(
            "core.geometry.point",
            inputs={
                "image": _image_reference(width=720, height=1280),
                "x": 120,
                "y": 340,
                "referenceWidth": 1080,
                "referenceHeight": 1920,
            },
        )

    assert failure.value.code is NodeExecutionFailureCode.REFERENCE_RESOLUTION_MISMATCH
    assert failure.value.parameters == {"parameterName": "referenceResolution"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("type_key", "inputs", "expected_code", "parameter_name"),
    [
        (
            "core.geometry.point",
            {"x": 1.5, "y": 2},
            NodeExecutionFailureCode.INPUT_TYPE_INVALID,
            "x",
        ),
        (
            "core.geometry.point",
            {"x": 1080, "y": 2},
            NodeExecutionFailureCode.COORDINATE_OUT_OF_BOUNDS,
            "point",
        ),
        (
            "core.geometry.rectangle",
            {"x": 0, "y": 0, "width": 0, "height": 10},
            NodeExecutionFailureCode.INPUT_TYPE_INVALID,
            "width",
        ),
        (
            "core.geometry.rectangle",
            {"x": 900, "y": 0, "width": 200, "height": 10},
            NodeExecutionFailureCode.COORDINATE_OUT_OF_BOUNDS,
            "rectangle",
        ),
    ],
)
async def test_geometry_nodes_reject_invalid_or_out_of_bounds_values(
    type_key: str,
    inputs: dict[str, RuntimeValue],
    expected_code: NodeExecutionFailureCode,
    parameter_name: str,
) -> None:
    complete_inputs: dict[str, RuntimeValue] = {
        "image": _image_reference(),
        "referenceWidth": 1080,
        "referenceHeight": 1920,
        **inputs,
    }
    with pytest.raises(NodeExecutionFailure) as failure:
        await _execute(type_key, inputs=complete_inputs)

    assert failure.value.code is expected_code
    assert failure.value.parameters == {"parameterName": parameter_name}


@pytest.mark.asyncio
async def test_delay_executor_is_cancelled_while_waiting() -> None:
    scope = CancellationScope()
    registry = build_phase_4_production_registry()
    delay_task = asyncio.create_task(
        registry.execute(
            "core.time.delay",
            NodeExecutionContext(
                node_id=NODE_ID,
                type_key="core.time.delay",
                inputs={"durationMilliseconds": 60_000},
                cancellation=scope,
            ),
        )
    )
    await asyncio.sleep(0)

    scope.cancel()

    with pytest.raises(RuntimeCancellationError):
        await asyncio.wait_for(delay_task, timeout=0.5)


@pytest.mark.asyncio
async def test_invalid_input_and_property_fail_with_stable_codes() -> None:
    with pytest.raises(NodeExecutionFailure) as missing_input:
        await _execute("core.logic.branch")
    with pytest.raises(NodeExecutionFailure) as invalid_number:
        await _execute(
            "core.logic.numberCompare",
            inputs={"left": True, "right": 3},
            properties={"operator": "greaterThan"},
        )
    with pytest.raises(NodeExecutionFailure) as invalid_operator:
        await _execute(
            "core.logic.numberCompare",
            inputs={"left": 5, "right": 3},
            properties={"operator": "approximately"},
        )

    assert missing_input.value.code is NodeExecutionFailureCode.INPUT_MISSING
    assert invalid_number.value.code is NodeExecutionFailureCode.INPUT_TYPE_INVALID
    assert invalid_operator.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert missing_input.value.parameters == {"parameterName": "condition"}


@pytest.mark.asyncio
async def test_fake_nodes_are_deterministic_and_explicitly_test_only() -> None:
    recorder = InMemoryFakeActionRecorder()
    registry = build_phase_4_test_registry(recorder)
    ocr_result = await registry.execute(
        "test.fake.ocr",
        _context(
            "test.fake.ocr",
            inputs={"fixtureText": "123.5"},
            properties={"matched": True},
        ),
    )
    no_match = await registry.execute(
        "test.fake.ocr",
        _context(
            "test.fake.ocr",
            inputs={"fixtureText": "ignored"},
            properties={"matched": False},
        ),
    )
    action_result = await registry.execute(
        "test.fake.action",
        _context(
            "test.fake.action",
            inputs={"label": "greater-branch"},
            device_key="test-device",
        ),
    )

    assert ocr_result.outputs == {"text": "123.5", "matched": True}
    assert no_match.outputs == {"text": "", "matched": False}
    assert action_result.outputs == {"recorded": True}
    assert recorder.records[0].node_id == NODE_ID
    assert recorder.records[0].device_key == "test-device"
    assert recorder.records[0].label == "greater-branch"


class _BlockingFakeActionRecorder:
    def __init__(self) -> None:
        self.entered: dict[str, asyncio.Event] = {}
        self.release = asyncio.Event()
        self.active_count = 0
        self.maximum_active_count = 0

    async def record(self, action: FakeActionRecord) -> None:
        self.active_count += 1
        self.maximum_active_count = max(
            self.maximum_active_count,
            self.active_count,
        )
        self.entered.setdefault(action.label, asyncio.Event()).set()
        try:
            await self.release.wait()
        finally:
            self.active_count -= 1


async def _wait_for_record(
    recorder: _BlockingFakeActionRecorder,
    label: str,
) -> None:
    while label not in recorder.entered:
        await asyncio.sleep(0)
    await asyncio.wait_for(recorder.entered[label].wait(), timeout=0.5)


@pytest.mark.asyncio
async def test_fake_action_device_serialization_and_parallelism() -> None:
    same_device_recorder = _BlockingFakeActionRecorder()
    same_device_registry = build_phase_4_test_registry(same_device_recorder)
    first = asyncio.create_task(
        same_device_registry.execute(
            "test.fake.action",
            _context(
                "test.fake.action",
                inputs={"label": "first"},
                device_key="device-a",
            ),
        )
    )
    await _wait_for_record(same_device_recorder, "first")
    second = asyncio.create_task(
        same_device_registry.execute(
            "test.fake.action",
            _context(
                "test.fake.action",
                inputs={"label": "second"},
                device_key="device-a",
            ),
        )
    )
    await asyncio.sleep(0)
    assert "second" not in same_device_recorder.entered
    same_device_recorder.release.set()
    await asyncio.gather(first, second)
    assert same_device_recorder.maximum_active_count == 1

    different_device_recorder = _BlockingFakeActionRecorder()
    different_device_registry = build_phase_4_test_registry(different_device_recorder)
    device_a = asyncio.create_task(
        different_device_registry.execute(
            "test.fake.action",
            _context(
                "test.fake.action",
                inputs={"label": "device-a"},
                device_key="device-a",
            ),
        )
    )
    device_b = asyncio.create_task(
        different_device_registry.execute(
            "test.fake.action",
            _context(
                "test.fake.action",
                inputs={"label": "device-b"},
                device_key="device-b",
            ),
        )
    )
    await asyncio.gather(
        _wait_for_record(different_device_recorder, "device-a"),
        _wait_for_record(different_device_recorder, "device-b"),
    )
    assert different_device_recorder.maximum_active_count == 2
    different_device_recorder.release.set()
    await asyncio.gather(device_a, device_b)


@pytest.mark.asyncio
async def test_fake_action_requires_a_run_bound_device() -> None:
    registry = build_phase_4_test_registry(InMemoryFakeActionRecorder())

    with pytest.raises(NodeExecutionFailure) as failure:
        await registry.execute(
            "test.fake.action",
            _context("test.fake.action", inputs={"label": "missing-device"}),
        )
    assert failure.value.code is NodeExecutionFailureCode.DEVICE_NOT_BOUND
