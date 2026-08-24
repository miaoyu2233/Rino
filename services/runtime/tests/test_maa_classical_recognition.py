"""Direct classical image-recognition nodes backed by the reviewed Maa surface."""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Self, cast
from uuid import UUID

import numpy as np
import pytest
from numpy.typing import NDArray

from rino_runtime.backends.base import AutomationBackend
from rino_runtime.backends.maa.binding import (
    MaaMatchCandidateSnapshot,
    MaaMatchSnapshot,
    OfficialMaaOcrSession,
)
from rino_runtime.execution_control import NeverCancelled
from rino_runtime.nodes import build_maa_backend_registry
from rino_runtime.nodes.execution import (
    NodeExecutionContext,
    RuntimeImageReference,
    RuntimeMatchCandidate,
    RuntimeMatchResult,
    RuntimeRect,
)


@dataclass
class _Job:
    detail: object
    succeeded: bool = True
    job_id: int = 41

    def wait(self) -> Self:
        return self

    def get(self, wait: bool = False) -> object:
        del wait
        return self.detail


class _Tasker:
    def __init__(self) -> None:
        self.recognition_type = ""
        self.parameter: object | None = None

    def post_recognition(
        self,
        recognition_type: str,
        recognition_parameter: object,
        image: NDArray[np.uint8],
    ) -> _Job:
        del image
        self.recognition_type = recognition_type
        self.parameter = recognition_parameter
        result_values: dict[str, object] = {"box": [10, 12, 40, 18]}
        if recognition_type == "TemplateMatch":
            result_values["score"] = 0.91
        else:
            result_values["count"] = 17
        recognition = SimpleNamespace(
            reco_id=73,
            algorithm=recognition_type,
            hit=True,
            filtered_results=[SimpleNamespace(**result_values)],
        )
        return _Job(SimpleNamespace(nodes=[SimpleNamespace(recognition=recognition)]))

    def post_stop(self) -> _Job:
        return _Job(SimpleNamespace(nodes=[]))


class _Resource:
    def __init__(self) -> None:
        self.overrides: list[tuple[str, NDArray[np.uint8]]] = []

    def override_image(
        self,
        image_name: str,
        image: NDArray[np.uint8],
    ) -> bool:
        self.overrides.append((image_name, image))
        return True


def _factory(**values: object) -> object:
    return values


def test_direct_session_exposes_only_reviewed_classical_recognizers() -> None:
    tasker = _Tasker()
    resource = _Resource()
    session = OfficialMaaOcrSession(
        tasker,
        _factory,
        resource=resource,
        template_match_parameter_factory=_factory,
        feature_match_parameter_factory=_factory,
        color_match_parameter_factory=_factory,
    )
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    template = np.zeros((20, 30, 3), dtype=np.uint8)

    template_result = session.recognize_template_match(
        image,
        template,
        roi=(5, 6, 120, 60),
        threshold=0.72,
        method=5,
        green_mask=False,
    )
    assert tasker.recognition_type == "TemplateMatch"
    assert isinstance(tasker.parameter, dict)
    assert tasker.parameter["threshold"] == [0.72]
    assert tasker.parameter["template"] == [resource.overrides[-1][0]]
    assert resource.overrides[-1][1] is template
    assert template_result == MaaMatchSnapshot(
        operation_id=73,
        matched=True,
        candidates=(MaaMatchCandidateSnapshot(0.91, (10, 12, 40, 18)),),
    )

    session.recognize_feature_match(
        image,
        template,
        roi=(0, 0, 0, 0),
        detector="SIFT",
        minimum_count=4,
        ratio=0.6,
        green_mask=True,
    )
    assert tasker.recognition_type == "FeatureMatch"
    assert isinstance(tasker.parameter, dict)
    assert tasker.parameter["detector"] == "SIFT"
    assert tasker.parameter["count"] == 4

    session.recognize_color_match(
        image,
        roi=(0, 0, 0, 0),
        lower=(10, 20, 30),
        upper=(40, 50, 60),
        method=4,
        minimum_count=12,
        connected=True,
    )
    assert tasker.recognition_type == "ColorMatch"
    assert isinstance(tasker.parameter, dict)
    assert tasker.parameter["lower"] == [[10, 20, 30]]
    assert tasker.parameter["upper"] == [[40, 50, 60]]
    assert tasker.parameter["connected"] is True


class _Backend:
    def __init__(self) -> None:
        self.color_call: tuple[object, ...] | None = None

    async def recognize_color_match(
        self,
        device_key: str,
        image: RuntimeImageReference,
        roi: RuntimeRect | None,
        lower: tuple[int, ...],
        upper: tuple[int, ...],
        method: int,
        minimum_count: int,
        connected: bool,
        cancellation: object,
        correlation: object,
    ) -> RuntimeMatchResult:
        del cancellation, correlation
        self.color_call = (
            device_key,
            image,
            roi,
            lower,
            upper,
            method,
            minimum_count,
            connected,
        )
        return RuntimeMatchResult(
            candidates=(
                RuntimeMatchCandidate(
                    84.0,
                    RuntimeRect(
                        11,
                        13,
                        17,
                        19,
                        image.coordinate_space_id,
                        image.generation,
                    ),
                ),
            ),
            matched=True,
            source_generation=image.generation,
            source_coordinate_space_id=image.coordinate_space_id,
            operation_id=92,
        )


@pytest.mark.asyncio
async def test_registry_exposes_and_executes_classical_recognition_nodes() -> None:
    backend = _Backend()
    registry = build_maa_backend_registry(
        cast(AutomationBackend, backend),
        include_ocr=False,
    )
    for type_key in (
        "vision.templateMatch",
        "vision.featureMatch",
        "vision.colorMatch",
    ):
        definition = registry.definition(type_key)
        assert definition is not None
        capabilities = [
            capability.root for capability in definition.required_capabilities or []
        ]
        assert capabilities == [type_key]

    image = RuntimeImageReference(
        handle_id="image-1",
        width=200,
        height=100,
        coordinate_space_id="space-1",
        generation=3,
        expires_at_monotonic=100.0,
    )
    result = await registry.execute(
        "vision.colorMatch",
        NodeExecutionContext(
            node_id=UUID(int=1),
            type_key="vision.colorMatch",
            device_key="device-1",
            inputs={"image": image},
            properties={
                "method": "RGB",
                "lower1": 10,
                "lower2": 20,
                "lower3": 30,
                "upper1": 40,
                "upper2": 50,
                "upper3": 60,
                "minimumCount": 12,
                "connected": True,
            },
            cancellation=NeverCancelled(),
        ),
    )

    assert backend.color_call is not None
    assert backend.color_call[3:8] == (
        (10, 20, 30),
        (40, 50, 60),
        4,
        12,
        True,
    )
    assert result.outputs["matched"] is True
    assert result.outputs["bestCount"] == 84.0
    assert result.outputs["bestRect"] == RuntimeRect(
        11,
        13,
        17,
        19,
        "space-1",
        3,
    )
