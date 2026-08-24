"""Reviewed Phase 4 node definitions and their deterministic executors."""

from __future__ import annotations

import math
import random
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar, Protocol, cast
from uuid import UUID

from rino_runtime.backends.android_actions import (
    ANDROID_INTENT_PATTERN,
    AndroidKey,
    validate_android_intent,
)
from rino_runtime.backends.base import (
    AndroidAppLaunchBackend,
    AndroidKeyBackend,
    AutomationBackend,
    CaptureAndOcrBackend,
    ClassicalRecognitionBackend,
    ClickRectBackend,
    ColorMatchBackend,
    DeviceServiceError,
    DeviceServiceErrorCode,
    FeatureMatchBackend,
    OcrRecognitionBackend,
    PointClickBackend,
    ScreenCaptureBackend,
    TemplateMatchBackend,
    TouchActionBackend,
)
from rino_runtime.contracts.generated.rino_registry_v1 import (
    NodeDefinitionV1,
    WorkflowTemplateV1,
)
from rino_runtime.execution_control import (
    DeviceLeaseManager,
    DeviceLeaseProvider,
    cancellable_delay,
)
from rino_runtime.nodes.bounded_retry import (
    BOUNDED_RETRY_MAXIMUM_ATTEMPTS,
    BOUNDED_RETRY_MAXIMUM_RATE_LIMIT_MILLISECONDS,
    BOUNDED_RETRY_MAXIMUM_TIMEOUT_MILLISECONDS,
    BOUNDED_RETRY_MINIMUM_RATE_LIMIT_MILLISECONDS,
    BOUNDED_RETRY_MINIMUM_TIMEOUT_MILLISECONDS,
)
from rino_runtime.nodes.execution import (
    NodeExecutionContext,
    NodeExecutionFailure,
    NodeExecutionFailureCode,
    NodeExecutionResult,
    RuntimeImageReference,
    RuntimeLogEntry,
    RuntimeLogLevel,
    RuntimeMatchCandidate,
    RuntimeMatchResult,
    RuntimeOcrCandidate,
    RuntimeOcrResult,
    RuntimePoint,
    RuntimeRect,
    RuntimeValue,
    SuccessorDispatchMode,
)
from rino_runtime.nodes.number_parsing import (
    NumberParsingOptions,
    parse_number,
    parse_typed_number,
)
from rino_runtime.nodes.numeric_expression import (
    NumericExpressionError,
    evaluate_numeric_expression,
)
from rino_runtime.nodes.registry import (
    MVP_PRODUCTION_NODE_TYPE_KEYS,
    PHASE_4_PRODUCTION_NODE_TYPE_KEYS,
    TEST_NODE_TYPE_KEYS,
    NodeRegistration,
    NodeRegistry,
    NodeRegistryBuilder,
)
from rino_runtime.nodes.variables import build_variable_registrations
from rino_runtime.task_choice import (
    TASK_CHOICE_TYPE_KEY,
    TASK_CHOICE_UNMATCHED_PORT_ID,
    parse_task_choice_cases,
    task_choice_case_for_id,
)

NUMERIC_INPUT_PORT_IDS = tuple(chr(ord("a") + index) for index in range(16))
COLLECTION_ITEM_PORT_IDS = tuple(f"item{index}" for index in range(1, 17))
DEFAULT_NUMERIC_INPUT_COUNT = 3
MINIMUM_NUMERIC_INPUT_COUNT = 2
MAXIMUM_NUMERIC_INPUT_COUNT = len(NUMERIC_INPUT_PORT_IDS)
MAXIMUM_SEQUENCE_STEP_COUNT = 16


def _numeric_input_count(context: NodeExecutionContext) -> int:
    value = context.dynamic_port_state.get("numericInputCount")
    if value is None:
        return DEFAULT_NUMERIC_INPUT_COUNT
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not MINIMUM_NUMERIC_INPUT_COUNT <= value <= MAXIMUM_NUMERIC_INPUT_COUNT
    ):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="dynamicPortState.numericInputCount",
        )
    return value


def _collection_item_count(context: NodeExecutionContext) -> int:
    value = context.dynamic_port_state.get("collectionItemCount")
    if value is None:
        return 2
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 16:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="dynamicPortState.collectionItemCount",
        )
    return value


class _StartExecutor:
    type_key = "core.flow.start"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult(selected_execution_outputs=("next",))


class _StopExecutor:
    type_key = "core.flow.stop"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult(terminal=True)


class _EndPathExecutor:
    type_key = "core.flow.endPath"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        scope = context.property_string("scope")
        if scope == "current":
            return NodeExecutionResult()
        if scope == "all":
            return NodeExecutionResult(terminal=True)
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="scope",
        )


def _sequence_step_count(
    dynamic_port_state: Mapping[str, object],
    sequence_order: object,
    external_order: object = None,
) -> int:
    value = dynamic_port_state.get("sequenceStepCount")
    if value is None:
        if (
            sequence_order is None
            and isinstance(external_order, list | tuple)
            and 1 <= len(external_order) <= MAXIMUM_SEQUENCE_STEP_COUNT
        ):
            return len(external_order)
        if isinstance(sequence_order, list | tuple) and 1 <= len(sequence_order) <= 16:
            return len(sequence_order)
        return MAXIMUM_SEQUENCE_STEP_COUNT
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= MAXIMUM_SEQUENCE_STEP_COUNT
    ):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="dynamicPortState.sequenceStepCount",
        )
    return value


def _validated_sequence_order(
    value: object,
    step_count: int,
    *,
    failure_code: NodeExecutionFailureCode,
    parameter_name: str,
) -> tuple[str, ...]:
    expected = tuple(f"step{index}" for index in range(1, step_count + 1))
    if (
        not isinstance(value, list | tuple)
        or len(value) != step_count
        or any(not isinstance(step_id, str) for step_id in value)
        or len(set(value)) != step_count
        or set(value) != set(expected)
    ):
        raise NodeExecutionFailure(failure_code, parameter_name=parameter_name)
    return tuple(cast("list[str] | tuple[str, ...]", value))


class _SequenceExecutor:
    type_key = "core.flow.sequence"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        step_count_value = context.dynamic_port_state.get("sequenceStepCount")
        authored_order = context.dynamic_port_state.get("sequenceOrder")
        external_order = context.inputs.get("order")
        if (
            step_count_value is None
            and authored_order is None
            and "order" not in context.inputs
        ):
            return NodeExecutionResult(
                selected_execution_outputs=(
                    "steps",
                    *(f"step{index}" for index in range(1, 17)),
                )
            )
        if "order" in context.inputs and not isinstance(external_order, tuple):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="order",
            )
        step_count = _sequence_step_count(
            context.dynamic_port_state,
            authored_order,
            external_order,
        )
        if "order" in context.inputs:
            selected_outputs = _validated_sequence_order(
                external_order,
                step_count,
                failure_code=NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="order",
            )
            return NodeExecutionResult(selected_execution_outputs=selected_outputs)
        if authored_order is not None:
            selected_outputs = _validated_sequence_order(
                authored_order,
                step_count,
                failure_code=NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="dynamicPortState.sequenceOrder",
            )
        else:
            selected_outputs = tuple(
                f"step{index}" for index in range(1, step_count + 1)
            )
        return NodeExecutionResult(selected_execution_outputs=selected_outputs)


class _SequenceOrderExecutor:
    type_key = "core.flow.sequenceOrder"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        authored_order = context.dynamic_port_state.get("sequenceOrder")
        step_count = _sequence_step_count(context.dynamic_port_state, authored_order)
        order = _validated_sequence_order(
            authored_order,
            step_count,
            failure_code=NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="dynamicPortState.sequenceOrder",
        )
        return NodeExecutionResult(outputs={"order": order})


class _RunCounterExecutor:
    type_key = "core.flow.runCounter"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        timing = context.activation_timing
        if timing is None:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="activationTiming",
            )
        target = context.require_number("targetCount")
        if not target.is_integer() or not 1 <= target <= 1_000_000:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="targetCount",
            )
        current_count = timing.activation_count
        return NodeExecutionResult(
            outputs={"currentCount": current_count},
            selected_execution_outputs=(
                "reached" if current_count >= int(target) else "notReached",
            ),
        )


class _BoundedRetryExecutor:
    type_key = "core.flow.boundedRetry"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        timing = context.activation_timing
        if timing is None:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="activationTiming",
            )
        timeout_milliseconds = _bounded_retry_integer(
            context,
            "timeoutMilliseconds",
            minimum=BOUNDED_RETRY_MINIMUM_TIMEOUT_MILLISECONDS,
            maximum=BOUNDED_RETRY_MAXIMUM_TIMEOUT_MILLISECONDS,
        )
        rate_limit_milliseconds = _bounded_retry_integer(
            context,
            "rateLimitMilliseconds",
            minimum=BOUNDED_RETRY_MINIMUM_RATE_LIMIT_MILLISECONDS,
            maximum=BOUNDED_RETRY_MAXIMUM_RATE_LIMIT_MILLISECONDS,
        )
        maximum_attempts = _bounded_retry_integer(
            context,
            "maximumAttempts",
            minimum=1,
            maximum=BOUNDED_RETRY_MAXIMUM_ATTEMPTS,
        )
        deadline = timing.first_started_at_monotonic + timeout_milliseconds / 1_000
        now = context.monotonic_now()
        if not math.isfinite(now) or now < timing.current_started_at_monotonic:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="activationTiming",
            )

        previous_started_at = timing.previous_started_at_monotonic
        if timing.activation_count > 1:
            if previous_started_at is None:
                raise NodeExecutionFailure(
                    NodeExecutionFailureCode.PROPERTY_INVALID,
                    parameter_name="activationTiming",
                )
            next_round_at = previous_started_at + rate_limit_milliseconds / 1_000
            wake_at = min(next_round_at, deadline)
            if now < wake_at:
                await cancellable_delay(wake_at - now, context.cancellation)
                now = context.monotonic_now()
                if not math.isfinite(now) or now < wake_at:
                    raise NodeExecutionFailure(
                        NodeExecutionFailureCode.PROPERTY_INVALID,
                        parameter_name="activationTiming",
                    )

        context.cancellation.raise_if_cancelled()
        elapsed_milliseconds = max(
            0.0,
            (now - timing.first_started_at_monotonic) * 1_000,
        )
        exhausted = now >= deadline or timing.activation_count > maximum_attempts
        return NodeExecutionResult(
            outputs={
                "attemptNumber": min(timing.activation_count, maximum_attempts),
                "elapsedMilliseconds": elapsed_milliseconds,
            },
            selected_execution_outputs=("exhausted" if exhausted else "attempt",),
        )


def _bounded_retry_integer(
    context: NodeExecutionContext,
    property_name: str,
    *,
    minimum: int,
    maximum: int,
) -> int:
    value = context.property_number(property_name)
    if not value.is_integer() or not minimum <= value <= maximum:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    return int(value)


class _TaskChoiceExecutor:
    type_key = TASK_CHOICE_TYPE_KEY

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        cases = parse_task_choice_cases(context.dynamic_port_state)
        if cases is None:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="dynamicPortState",
            )
        selected_case_id = context.property_string("selectedCaseId")
        selected_case = task_choice_case_for_id(cases, selected_case_id)
        if selected_case is None:
            return NodeExecutionResult(
                outputs={"selectedCaseId": selected_case_id},
                selected_execution_outputs=(TASK_CHOICE_UNMATCHED_PORT_ID,),
            )
        return NodeExecutionResult(
            outputs={"selectedCaseId": selected_case.case_id},
            selected_execution_outputs=(selected_case.port_id,),
        )


class _NoCaseOverlayValue:
    """Sentinel for an image overlay with no selected or fallback value."""


NO_CASE_OVERLAY_VALUE = _NoCaseOverlayValue()


def _case_overlay_input_value(
    context: NodeExecutionContext,
    *,
    expected_kind: str,
    port_id: str,
) -> RuntimeValue:
    value = context.inputs[port_id]
    if expected_kind == "bool":
        if not isinstance(value, bool):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return value
    if expected_kind == "number":
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        try:
            number = float(value)
        except OverflowError:
            number = math.inf
        if not math.isfinite(number):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return number
    if expected_kind == "imageRef":
        if not isinstance(value, RuntimeImageReference):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return value
    raise AssertionError(f"Unsupported case overlay kind: {expected_kind}")


def _resolve_case_overlay_value(
    context: NodeExecutionContext,
    *,
    expected_kind: str,
    fallback_required: bool,
) -> RuntimeValue | _NoCaseOverlayValue:
    cases = parse_task_choice_cases(context.dynamic_port_state)
    if cases is None:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="dynamicPortState",
        )
    selected_case_id = context.require_string("selectedCaseId")
    selected_case = task_choice_case_for_id(cases, selected_case_id)
    if selected_case is None:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.INPUT_TYPE_INVALID,
            parameter_name="selectedCaseId",
        )
    selected_port_id = selected_case.port_id
    if selected_port_id in context.inputs:
        return _case_overlay_input_value(
            context,
            expected_kind=expected_kind,
            port_id=selected_port_id,
        )
    if "fallback" in context.inputs:
        return _case_overlay_input_value(
            context,
            expected_kind=expected_kind,
            port_id="fallback",
        )
    if fallback_required:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.INPUT_MISSING,
            parameter_name="fallback",
        )
    return NO_CASE_OVERLAY_VALUE


class _CaseOverlayExecutor:
    def __init__(
        self, type_key: str, expected_kind: str, fallback_required: bool
    ) -> None:
        self.type_key = type_key
        self._expected_kind = expected_kind
        self._fallback_required = fallback_required

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        value = _resolve_case_overlay_value(
            context,
            expected_kind=self._expected_kind,
            fallback_required=self._fallback_required,
        )
        if isinstance(value, _NoCaseOverlayValue):
            return NodeExecutionResult()
        return NodeExecutionResult(outputs={"value": value})


class _ParallelExecutor:
    type_key = "core.flow.parallel"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        branch_count_value = context.dynamic_port_state.get("parallelBranchCount")
        branch_count = 2 if branch_count_value is None else branch_count_value
        if (
            isinstance(branch_count, bool)
            or not isinstance(branch_count, int)
            or branch_count not in (2, 3)
        ):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="dynamicPortState.parallelBranchCount",
            )
        return NodeExecutionResult(
            selected_execution_outputs=tuple(
                f"branch{index}" for index in range(1, branch_count + 1)
            ),
            successor_dispatch=SuccessorDispatchMode.CONCURRENT,
        )


class _BranchExecutor:
    type_key = "core.logic.branch"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        selected = "whenTrue" if context.require_bool("condition") else "whenFalse"
        return NodeExecutionResult(selected_execution_outputs=(selected,))


class _NumberCompareExecutor:
    type_key = "core.logic.numberCompare"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        left = context.require_number("left")
        right = context.require_number("right")
        operator = context.property_string("operator")
        operations = {
            "greaterThan": left > right,
            "greaterThanOrEqual": left >= right,
            "lessThan": left < right,
            "lessThanOrEqual": left <= right,
            "equalTo": left == right,
            "notEqualTo": left != right,
        }
        if operator not in operations:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="operator",
            )
        relation = (
            "lessThan" if left < right else "greaterThan" if left > right else "equalTo"
        )
        return NodeExecutionResult(
            outputs={"result": operations[operator], "relation": relation}
        )


class _ArithmeticExecutor:
    type_key = "core.math.arithmetic"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        left = context.require_number("left")
        right = context.require_number("right")
        operator = context.property_string("operator")
        if operator == "add":
            result = left + right
        elif operator == "subtract":
            result = left - right
        elif operator == "multiply":
            result = left * right
        elif operator == "divide":
            if right == 0:
                raise NodeExecutionFailure(
                    NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                    parameter_name="right",
                )
            result = left / right
        else:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="operator",
            )
        if not math.isfinite(result):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="result",
            )
        return NodeExecutionResult(outputs={"result": result})


class _NumericExpressionExecutor:
    type_key = "core.math.expression"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        input_count = _numeric_input_count(context)
        variables = {
            port_id: context.require_number(port_id)
            for port_id in NUMERIC_INPUT_PORT_IDS[:input_count]
            if port_id in context.inputs
        }
        expression = context.property_string("expression")
        try:
            result = evaluate_numeric_expression(expression, variables)
        except NumericExpressionError as error:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name=f"expression.{error}",
            ) from error
        return NodeExecutionResult(outputs={"result": result})


class _NumberSelectExecutor:
    type_key = "core.logic.numberSelect"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        input_count = _numeric_input_count(context)
        entries = tuple(
            (port_id, context.require_number(port_id))
            for port_id in NUMERIC_INPUT_PORT_IDS[:input_count]
        )
        mode = context.property_string("mode")
        if mode == "maximum":
            selected_name, selected_value = max(entries, key=lambda item: item[1])
        elif mode == "minimum":
            selected_name, selected_value = min(entries, key=lambda item: item[1])
        else:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="mode",
            )
        return NodeExecutionResult(
            outputs={"value": selected_value, "condition": selected_name}
        )


class _ImageListExecutor:
    type_key = "core.collection.imageList"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        count = _collection_item_count(context)
        return NodeExecutionResult(
            outputs={
                "images": tuple(
                    context.require_image_reference(port_id)
                    for port_id in COLLECTION_ITEM_PORT_IDS[:count]
                )
            }
        )


class _RegionListExecutor:
    type_key = "core.collection.regionList"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        count = _collection_item_count(context)
        return NodeExecutionResult(
            outputs={
                "regions": tuple(
                    context.require_rect(port_id)
                    for port_id in COLLECTION_ITEM_PORT_IDS[:count]
                )
            }
        )


class _PointListExecutor:
    type_key = "core.collection.pointList"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        count = _collection_item_count(context)
        return NodeExecutionResult(
            outputs={
                "points": tuple(
                    context.require_point(port_id)
                    for port_id in COLLECTION_ITEM_PORT_IDS[:count]
                )
            }
        )


class _NumberLiteralExecutor:
    type_key = "core.value.numberLiteral"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult(outputs={"value": context.property_number("value")})


class _StringLiteralExecutor:
    type_key = "core.value.stringLiteral"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult(outputs={"value": context.property_string("value")})


class _ProjectImageAssetExecutor:
    type_key = "core.image.projectAsset"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        asset_id = context.property_string("assetId")
        return NodeExecutionResult(
            outputs={"image": context.require_project_asset(asset_id)}
        )


class _UnavailableCapabilityExecutor:
    def __init__(self, type_key: str) -> None:
        self.type_key = type_key

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.CAPABILITY_UNAVAILABLE,
            parameter_name=self.type_key,
        )


class _PointExecutor:
    type_key = "core.geometry.point"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult(outputs={"point": _bound_point(context)})


def _bound_point(context: NodeExecutionContext) -> RuntimePoint:
    image = context.require_image_reference("image")
    x = _coordinate_integer(context, "x")
    y = _coordinate_integer(context, "y")
    _require_reference_resolution(context, image.width, image.height)
    if x >= image.width or y >= image.height:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.COORDINATE_OUT_OF_BOUNDS,
            parameter_name="point",
        )
    return RuntimePoint(
        x=x,
        y=y,
        coordinate_space_id=image.coordinate_space_id,
        source_generation=image.generation,
    )


class _RectangleExecutor:
    type_key = "core.geometry.rectangle"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        image = context.require_image_reference("image")
        x = _coordinate_integer(context, "x")
        y = _coordinate_integer(context, "y")
        width = _positive_coordinate_integer(context, "width")
        height = _positive_coordinate_integer(context, "height")
        _require_reference_resolution(context, image.width, image.height)
        if x + width > image.width or y + height > image.height:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.COORDINATE_OUT_OF_BOUNDS,
                parameter_name="rectangle",
            )
        return NodeExecutionResult(
            outputs={
                "rectangle": RuntimeRect(
                    x=x,
                    y=y,
                    width=width,
                    height=height,
                    coordinate_space_id=image.coordinate_space_id,
                    source_generation=image.generation,
                )
            }
        )


def _coordinate_integer(context: NodeExecutionContext, port_id: str) -> int:
    value = context.require_number(port_id)
    if value < 0 or not value.is_integer():
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.INPUT_TYPE_INVALID,
            parameter_name=port_id,
        )
    return int(value)


def _positive_coordinate_integer(
    context: NodeExecutionContext,
    port_id: str,
) -> int:
    value = _coordinate_integer(context, port_id)
    if value == 0:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.INPUT_TYPE_INVALID,
            parameter_name=port_id,
        )
    return value


def _require_reference_resolution(
    context: NodeExecutionContext,
    image_width: int,
    image_height: int,
) -> None:
    reference_width = _positive_coordinate_integer(context, "referenceWidth")
    reference_height = _positive_coordinate_integer(context, "referenceHeight")
    if reference_width != image_width or reference_height != image_height:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.REFERENCE_RESOLUTION_MISMATCH,
            parameter_name="referenceResolution",
        )


class _DelayExecutor:
    type_key = "core.time.delay"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        duration_milliseconds = context.require_number("durationMilliseconds")
        if duration_milliseconds < 0 or duration_milliseconds > 86_400_000:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="durationMilliseconds",
            )
        await cancellable_delay(
            duration_milliseconds / 1000,
            context.cancellation,
        )
        return NodeExecutionResult(selected_execution_outputs=("next",))


class _LogExecutor:
    type_key = "core.diagnostic.log"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        raw_segment_kinds = context.properties.get("segmentKinds")
        if raw_segment_kinds is None:
            if "textPart1" in context.inputs:
                segment_kinds: tuple[str, ...] = ("text",)
            elif "message" in context.inputs:
                segment_kinds = ("legacy",)
            else:
                raise NodeExecutionFailure(
                    NodeExecutionFailureCode.INPUT_MISSING,
                    parameter_name="textPart1",
                )
        elif isinstance(raw_segment_kinds, tuple) and all(
            isinstance(kind, str) for kind in raw_segment_kinds
        ):
            segment_kinds = tuple(
                kind for kind in raw_segment_kinds if isinstance(kind, str)
            )
        else:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="segmentKinds",
            )
        if segment_kinds != ("legacy",) and (
            not 1 <= len(segment_kinds) <= 16
            or any(kind not in {"text", "number"} for kind in segment_kinds)
        ):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="segmentKinds",
            )

        if segment_kinds == ("legacy",):
            message = context.require_string("message")
        else:
            message_parts: list[str] = []
            for index, segment_kind in enumerate(segment_kinds, start=1):
                if segment_kind == "text":
                    message_parts.append(context.require_string(f"textPart{index}"))
                else:
                    number = context.require_number(f"numberPart{index}")
                    message_parts.append(
                        str(int(number))
                        if number.is_integer()
                        else format(number, ".15g")
                    )
            message = "".join(message_parts)

        append_newline = context.properties.get("appendNewline", False)
        if not isinstance(append_newline, bool):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="appendNewline",
            )
        if append_newline:
            message += "\n"
        if len(message) > 4096:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="segments",
            )
        return NodeExecutionResult(
            selected_execution_outputs=("next",),
            logs=(RuntimeLogEntry(RuntimeLogLevel.INFO, message),),
        )


class _ParseNumberExecutor:
    type_key = "text.parseNumber"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        options = _number_parsing_options(context)
        original_text = context.require_string("text")
        parsed = parse_number(original_text, options)
        if parsed is None:
            return NodeExecutionResult(
                outputs={"normalizedText": original_text.strip()},
                selected_execution_outputs=("invalid",),
            )
        return NodeExecutionResult(
            outputs={
                "number": parsed.value,
                "normalizedText": parsed.normalized_text,
            },
            selected_execution_outputs=("parsed",),
        )


class _ReadTextExecutor:
    type_key = "text.readText"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        candidate = _selected_ocr_candidate(context)
        if candidate is None:
            return NodeExecutionResult(selected_execution_outputs=("missing",))
        return NodeExecutionResult(
            outputs={"text": candidate.text, "rect": candidate.rect},
            selected_execution_outputs=("selected",),
        )


class _ReadNumberExecutor:
    type_key = "text.readNumber"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        candidate = _selected_ocr_candidate(context)
        if candidate is None:
            return NodeExecutionResult(selected_execution_outputs=("missing",))
        parsed = parse_number(candidate.text, _number_parsing_options(context))
        if parsed is None:
            return NodeExecutionResult(
                outputs={
                    "normalizedText": candidate.text.strip(),
                    "rect": candidate.rect,
                },
                selected_execution_outputs=("invalid",),
            )
        return NodeExecutionResult(
            outputs={
                "number": parsed.value,
                "normalizedText": parsed.normalized_text,
                "rect": candidate.rect,
            },
            selected_execution_outputs=("selected",),
        )


class _ReadValueExecutor:
    type_key = "text.readValue"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        value_mode = _read_value_choice(
            context,
            "valueMode",
            "number",
            ("text", "number"),
        )
        number_type = _read_value_choice(
            context,
            "numberType",
            "float",
            ("integer", "float", "percentage", "positive", "unsignedInteger"),
        )
        selection_mode = _read_value_choice(
            context,
            "selectionMode",
            "position",
            ("all", "position"),
        )
        reading_order = _read_value_choice(
            context,
            "readingOrder",
            "rowMajor",
            ("rowMajor", "columnMajor"),
        )
        line_index = _read_value_index(context, "lineIndex")
        item_index = _read_value_index(context, "itemIndex")
        number_options = (
            _read_value_number_options(context) if value_mode == "number" else None
        )
        result = context.require_ocr_result("result")
        if not result.matched:
            return NodeExecutionResult(selected_execution_outputs=("missing",))

        groups = _spatially_grouped_candidates(
            result.candidates[:256],
            reading_order,
        )
        if not groups:
            return NodeExecutionResult(selected_execution_outputs=("missing",))

        if selection_mode == "position":
            candidate = (
                groups[line_index - 1][item_index - 1]
                if line_index <= len(groups)
                and item_index <= len(groups[line_index - 1])
                else None
            )
            if candidate is None:
                return NodeExecutionResult(
                    selected_execution_outputs=("missing",),
                )
            selected_candidate = candidate[1]
            if value_mode == "text":
                return NodeExecutionResult(
                    outputs={
                        "text": selected_candidate.text,
                        "rect": selected_candidate.rect,
                    },
                    selected_execution_outputs=("selected",),
                )
            assert number_options is not None
            parsed = parse_typed_number(
                selected_candidate.text,
                number_options,
                number_type,
            )
            if parsed is None:
                return NodeExecutionResult(
                    selected_execution_outputs=("invalid",),
                )
            return NodeExecutionResult(
                outputs={"number": parsed.value, "rect": selected_candidate.rect},
                selected_execution_outputs=("selected",),
            )

        ordered_candidates = [
            candidate
            for group in groups
            for candidate in group
            if _has_ocr_text(candidate[1])
        ]
        if value_mode == "text":
            if not ordered_candidates:
                return NodeExecutionResult(
                    selected_execution_outputs=("missing",),
                )
            return NodeExecutionResult(
                outputs={
                    "texts": tuple(
                        candidate.text for _, candidate in ordered_candidates
                    ),
                    "rects": tuple(
                        candidate.rect for _, candidate in ordered_candidates
                    ),
                },
                selected_execution_outputs=("selected",),
            )

        assert number_options is not None
        parsed_values = [
            (parsed.value, candidate.rect)
            for _, candidate in ordered_candidates
            if (
                parsed := parse_typed_number(
                    candidate.text,
                    number_options,
                    number_type,
                )
            )
            is not None
        ]
        if not parsed_values:
            return NodeExecutionResult(selected_execution_outputs=("invalid",))
        return NodeExecutionResult(
            outputs={
                "numbers": tuple(value for value, _ in parsed_values),
                "rects": tuple(rect for _, rect in parsed_values),
            },
            selected_execution_outputs=("selected",),
        )


def _read_value_choice(
    context: NodeExecutionContext,
    property_name: str,
    default: str,
    choices: tuple[str, ...],
) -> str:
    value = context.properties.get(property_name, default)
    if not isinstance(value, str) or value not in choices:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    return value


def _read_value_index(context: NodeExecutionContext, property_name: str) -> int:
    value = context.properties.get(property_name, 1)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    try:
        number = float(value)
    except OverflowError:
        number = math.inf
    if not math.isfinite(number) or not number.is_integer() or not 1 <= number <= 256:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    return int(number)


def _read_value_bool(
    context: NodeExecutionContext,
    property_name: str,
    default: bool,
) -> bool:
    value = context.properties.get(property_name, default)
    if not isinstance(value, bool):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    return value


def _read_value_optional_number(
    context: NodeExecutionContext,
    property_name: str,
) -> float | None:
    value = context.properties.get(property_name)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    try:
        number = float(value)
    except OverflowError:
        number = math.inf
    if not math.isfinite(number):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    return number


def _read_value_number_options(context: NodeExecutionContext) -> NumberParsingOptions:
    decimal_separator = _read_value_choice(
        context,
        "decimalSeparator",
        ".",
        (".", ","),
    )
    grouping_separator = _read_value_choice(
        context,
        "groupingSeparator",
        ",",
        ("", ".", ",", " "),
    )
    try:
        return NumberParsingOptions(
            decimal_separator=decimal_separator,
            grouping_separator=grouping_separator,
            normalize_full_width=_read_value_bool(
                context,
                "normalizeFullWidth",
                False,
            ),
            allow_sign=_read_value_bool(context, "allowSign", True),
            minimum=_read_value_optional_number(context, "minimum"),
            maximum=_read_value_optional_number(context, "maximum"),
        )
    except ValueError as error:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="groupingSeparator",
        ) from error


def _has_ocr_text(candidate: RuntimeOcrCandidate) -> bool:
    return isinstance(candidate.text, str) and bool(candidate.text.strip())


def _selected_ocr_candidate(
    context: NodeExecutionContext,
) -> RuntimeOcrCandidate | None:
    result: RuntimeOcrResult = context.require_ocr_result("result")
    index_value = context.property_number("candidateIndex")
    if not index_value.is_integer() or not 1 <= index_value <= 256:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="candidateIndex",
        )
    reading_order = context.property_string("readingOrder")
    if reading_order not in {"rowMajor", "columnMajor"}:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="readingOrder",
        )
    ordered = _spatially_ordered_candidates(result.candidates, reading_order)
    if not result.matched:
        return None
    selected_index = int(index_value) - 1
    return ordered[selected_index][1] if selected_index < len(ordered) else None


def _spatially_ordered_candidates(
    candidates: tuple[RuntimeOcrCandidate, ...],
    reading_order: str,
) -> list[tuple[int, RuntimeOcrCandidate]]:
    return [
        item
        for group in _spatially_grouped_candidates(candidates, reading_order)
        for item in group
    ]


def _spatially_grouped_candidates(
    candidates: tuple[RuntimeOcrCandidate, ...],
    reading_order: str,
) -> list[list[tuple[int, RuntimeOcrCandidate]]]:
    row_major = reading_order == "rowMajor"
    indexed = list(enumerate(candidates))
    indexed.sort(
        key=lambda item: (
            item[1].rect.y if row_major else item[1].rect.x,
            item[1].rect.x if row_major else item[1].rect.y,
            item[0],
        )
    )
    groups: list[list[tuple[int, RuntimeOcrCandidate]]] = []
    for item in indexed:
        if not groups or not _shares_reading_band(groups[-1], item, row_major):
            groups.append([item])
        else:
            groups[-1].append(item)
    for group in groups:
        group.sort(
            key=lambda item: (
                item[1].rect.x if row_major else item[1].rect.y,
                item[1].rect.y if row_major else item[1].rect.x,
                item[0],
            )
        )
    return groups


def _shares_reading_band(
    group: list[tuple[int, RuntimeOcrCandidate]],
    item: tuple[int, RuntimeOcrCandidate],
    row_major: bool,
) -> bool:
    candidate = item[1]
    candidate_start = candidate.rect.y if row_major else candidate.rect.x
    candidate_size = candidate.rect.height if row_major else candidate.rect.width
    candidate_end = candidate_start + candidate_size
    group_start = min(
        member.rect.y if row_major else member.rect.x for _, member in group
    )
    group_end = max(
        (member.rect.y + member.rect.height)
        if row_major
        else (member.rect.x + member.rect.width)
        for _, member in group
    )
    return candidate_start < group_end and candidate_end > group_start


def _number_parsing_options(
    context: NodeExecutionContext,
) -> NumberParsingOptions:
    minimum = context.properties.get("minimum")
    maximum = context.properties.get("maximum")
    return NumberParsingOptions(
        decimal_separator=context.property_string("decimalSeparator"),
        grouping_separator=context.property_string("groupingSeparator"),
        normalize_full_width=context.property_bool("normalizeFullWidth"),
        allow_sign=context.property_bool("allowSign"),
        minimum=_optional_number(minimum, "minimum"),
        maximum=_optional_number(maximum, "maximum"),
    )


def _optional_number(value: object, property_name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    return float(value)


class _CaptureScreenExecutor:
    type_key = "automation.captureScreen"

    def __init__(self, backend: ScreenCaptureBackend) -> None:
        self._backend = backend

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        image = await self._backend.capture_screen(
            context.device_key,
            context.cancellation,
            context.operation_correlation(),
        )
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult(
            outputs={
                "image": image,
                "width": image.width,
                "height": image.height,
            },
            selected_execution_outputs=("next",),
        )


class _OcrExecutor:
    type_key = "vision.ocr"

    def __init__(self, backend: OcrRecognitionBackend) -> None:
        self._backend = backend

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        image = context.require_image_reference("image")
        regions: tuple[RuntimeRect | None, ...] = (
            context.require_rects("regions")
            if "regions" in context.inputs
            else (_optional_roi(context),)
        )
        confidence_threshold = (
            context.require_number("confidenceThreshold")
            if "confidenceThreshold" in context.inputs
            else context.property_number("confidenceThreshold")
        )
        if not 0 <= confidence_threshold <= 1:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="confidenceThreshold",
            )
        expected_patterns = _compile_ocr_expected_patterns(
            context.properties.get("expected")
        )
        result: RuntimeOcrResult | None = None
        best: RuntimeOcrCandidate | None = None
        matched_region_index = 0
        for region_index, region in enumerate(regions, start=1):
            result = await self._backend.recognize_ocr(
                context.device_key,
                image,
                region,
                confidence_threshold,
                context.cancellation,
                context.operation_correlation(),
            )
            context.cancellation.raise_if_cancelled()
            best = (
                _best_ocr_candidate(
                    result.candidates,
                    expected_patterns=expected_patterns,
                )
                if result.matched
                else None
            )
            if best is not None:
                matched_region_index = region_index
                break
        if result is None:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="regions",
            )
        outputs: dict[str, RuntimeValue] = {
            "result": result,
            "matched": best is not None,
            "bestText": "" if best is None else best.text,
            "bestConfidence": 0.0 if best is None else best.confidence,
            "matchedRegionIndex": matched_region_index,
        }
        if best is not None:
            outputs["bestRect"] = best.rect
        return NodeExecutionResult(
            outputs=outputs,
            selected_execution_outputs=("next",),
        )


def _optional_roi(context: NodeExecutionContext) -> RuntimeRect | None:
    roi = context.inputs.get("roi")
    if roi is not None and not isinstance(roi, RuntimeRect):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.INPUT_TYPE_INVALID,
            parameter_name="roi",
        )
    return roi


def _match_outputs(
    result: RuntimeMatchResult,
    *,
    best_metric_port: str,
    metrics_port: str,
) -> dict[str, RuntimeValue]:
    best = _best_match_candidate(result.candidates) if result.matched else None
    outputs: dict[str, RuntimeValue] = {
        "matched": best is not None,
        best_metric_port: 0.0 if best is None else best.metric,
        "rects": tuple(candidate.rect for candidate in result.candidates),
        metrics_port: tuple(candidate.metric for candidate in result.candidates),
    }
    if best is not None:
        outputs["bestRect"] = best.rect
    return outputs


def _best_match_candidate(
    candidates: tuple[RuntimeMatchCandidate, ...],
) -> RuntimeMatchCandidate | None:
    if not candidates:
        return None
    return max(
        enumerate(candidates),
        key=lambda indexed: (indexed[1].metric, -indexed[0]),
    )[1]


class _TemplateMatchExecutor:
    type_key = "vision.templateMatch"

    _METHODS: ClassVar[dict[str, int]] = {
        "rgbDifference": 10001,
        "coefficient": 3,
        "normalizedCoefficient": 5,
    }

    def __init__(self, backend: TemplateMatchBackend) -> None:
        self._backend = backend

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        threshold = (
            context.require_number("threshold")
            if "threshold" in context.inputs
            else context.property_number("threshold")
        )
        method_name = context.property_string("method")
        method = self._METHODS.get(method_name)
        if not 0 <= threshold <= 1 or method is None:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="threshold" if method is not None else "method",
            )
        image = context.require_image_reference("image")
        templates = (
            context.require_image_references("templates")
            if "templates" in context.inputs
            else (context.require_image_reference("template"),)
        )
        regions: tuple[RuntimeRect | None, ...] = (
            context.require_rects("regions")
            if "regions" in context.inputs
            else (_optional_roi(context),)
        )
        result: RuntimeMatchResult | None = None
        matched_template_index = 0
        matched_region_index = 0
        for template_index, template in enumerate(templates, start=1):
            for region_index, region in enumerate(regions, start=1):
                result = await self._backend.recognize_template_match(
                    context.device_key,
                    image,
                    template,
                    region,
                    threshold,
                    method,
                    context.property_bool("greenMask"),
                    context.cancellation,
                    context.operation_correlation(),
                )
                context.cancellation.raise_if_cancelled()
                if result.matched and _best_match_candidate(result.candidates):
                    matched_template_index = template_index
                    matched_region_index = region_index
                    break
            if matched_template_index > 0:
                break
        if result is None:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="templates",
            )
        context.cancellation.raise_if_cancelled()
        outputs = _match_outputs(
            result,
            best_metric_port="bestScore",
            metrics_port="scores",
        )
        outputs.update(
            {
                "matchedTemplateIndex": matched_template_index,
                "matchedRegionIndex": matched_region_index,
            }
        )
        if matched_template_index > 0:
            outputs["matchedTemplate"] = templates[matched_template_index - 1]
        return NodeExecutionResult(
            outputs=outputs,
            selected_execution_outputs=("next",),
        )


class _FeatureMatchExecutor:
    type_key = "vision.featureMatch"

    _DETECTORS = frozenset({"SIFT", "KAZE", "AKAZE", "BRISK", "ORB"})

    def __init__(self, backend: FeatureMatchBackend) -> None:
        self._backend = backend

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        detector = context.property_string("detector")
        minimum_count = context.property_number("minimumCount")
        ratio = context.property_number("ratio")
        if detector not in self._DETECTORS:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="detector",
            )
        if not minimum_count.is_integer() or not 1 <= minimum_count <= 1000:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="minimumCount",
            )
        if not 0 < ratio < 1:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="ratio",
            )
        image = context.require_image_reference("image")
        templates = (
            context.require_image_references("templates")
            if "templates" in context.inputs
            else (context.require_image_reference("template"),)
        )
        regions: tuple[RuntimeRect | None, ...] = (
            context.require_rects("regions")
            if "regions" in context.inputs
            else (_optional_roi(context),)
        )
        result: RuntimeMatchResult | None = None
        matched_template_index = 0
        matched_region_index = 0
        for template_index, template in enumerate(templates, start=1):
            for region_index, region in enumerate(regions, start=1):
                result = await self._backend.recognize_feature_match(
                    context.device_key,
                    image,
                    template,
                    region,
                    detector,
                    int(minimum_count),
                    ratio,
                    context.property_bool("greenMask"),
                    context.cancellation,
                    context.operation_correlation(),
                )
                context.cancellation.raise_if_cancelled()
                if result.matched and _best_match_candidate(result.candidates):
                    matched_template_index = template_index
                    matched_region_index = region_index
                    break
            if matched_template_index > 0:
                break
        if result is None:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="templates",
            )
        context.cancellation.raise_if_cancelled()
        outputs = _match_outputs(
            result,
            best_metric_port="bestCount",
            metrics_port="counts",
        )
        outputs.update(
            {
                "matchedTemplateIndex": matched_template_index,
                "matchedRegionIndex": matched_region_index,
            }
        )
        if matched_template_index > 0:
            outputs["matchedTemplate"] = templates[matched_template_index - 1]
        return NodeExecutionResult(
            outputs=outputs,
            selected_execution_outputs=("next",),
        )


class _ColorMatchExecutor:
    type_key = "vision.colorMatch"

    _METHODS: ClassVar[dict[str, int]] = {"RGB": 4, "HSV": 40, "GRAY": 6}

    def __init__(self, backend: ColorMatchBackend) -> None:
        self._backend = backend

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        method_name = context.property_string("method")
        method = self._METHODS.get(method_name)
        minimum_count = context.property_number("minimumCount")
        if method is None:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="method",
            )
        if not minimum_count.is_integer() or not 1 <= minimum_count <= 1_000_000:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="minimumCount",
            )
        channel_count = 1 if method_name == "GRAY" else 3
        lower = tuple(
            _color_channel(context, f"lower{index}")
            for index in range(1, channel_count + 1)
        )
        upper = tuple(
            _color_channel(context, f"upper{index}")
            for index in range(1, channel_count + 1)
        )
        if any(low > high for low, high in zip(lower, upper, strict=True)):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="colorRange",
            )
        image = context.require_image_reference("image")
        regions: tuple[RuntimeRect | None, ...] = (
            context.require_rects("regions")
            if "regions" in context.inputs
            else (_optional_roi(context),)
        )
        result: RuntimeMatchResult | None = None
        matched_region_index = 0
        for region_index, region in enumerate(regions, start=1):
            result = await self._backend.recognize_color_match(
                context.device_key,
                image,
                region,
                lower,
                upper,
                method,
                int(minimum_count),
                context.property_bool("connected"),
                context.cancellation,
                context.operation_correlation(),
            )
            context.cancellation.raise_if_cancelled()
            if result.matched and _best_match_candidate(result.candidates):
                matched_region_index = region_index
                break
        if result is None:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="regions",
            )
        context.cancellation.raise_if_cancelled()
        outputs = _match_outputs(
            result,
            best_metric_port="bestCount",
            metrics_port="counts",
        )
        outputs["matchedRegionIndex"] = matched_region_index
        return NodeExecutionResult(
            outputs=outputs,
            selected_execution_outputs=("next",),
        )


def _color_channel(context: NodeExecutionContext, property_name: str) -> int:
    value = context.property_number(property_name)
    if not value.is_integer() or not 0 <= value <= 255:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    return int(value)


def _best_ocr_candidate(
    candidates: tuple[RuntimeOcrCandidate, ...],
    *,
    expected_patterns: tuple[re.Pattern[str], ...] = (),
) -> RuntimeOcrCandidate | None:
    if not candidates:
        return None
    if expected_patterns:
        return min(
            enumerate(candidates),
            key=lambda indexed: (
                _ocr_expected_rank(indexed[1], expected_patterns),
                -indexed[1].confidence,
                indexed[0],
            ),
        )[1]
    return max(
        enumerate(candidates),
        key=lambda indexed: (indexed[1].confidence, -indexed[0]),
    )[1]


def _compile_ocr_expected_patterns(
    value: RuntimeValue | None,
) -> tuple[re.Pattern[str], ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        raw_values: tuple[object, ...] = (value,)
    elif isinstance(value, (list, tuple)):
        raw_values = tuple(value)
    else:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="expected",
        )
    if len(raw_values) > 32 or any(
        not isinstance(pattern, str) or len(pattern) > 256 for pattern in raw_values
    ):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="expected",
        )
    raw_patterns = tuple(cast(str, pattern) for pattern in raw_values)
    try:
        return tuple(re.compile(pattern) for pattern in raw_patterns)
    except re.error as error:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="expected",
        ) from error


def _ocr_expected_rank(
    candidate: RuntimeOcrCandidate,
    patterns: tuple[re.Pattern[str], ...],
) -> int:
    for index, pattern in enumerate(patterns):
        if pattern.search(candidate.text) is not None:
            return index
    return len(patterns)


class _ClickRectCenterExecutor:
    type_key = "automation.clickRectCenter"

    def __init__(
        self,
        backend: ClickRectBackend,
        lease_provider: DeviceLeaseProvider,
    ) -> None:
        self._backend = backend
        self._lease_provider = lease_provider

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        rect = context.require_rect("rect")
        adjusted_rect = RuntimeRect(
            x=rect.x + _click_rect_offset(context, "offsetX"),
            y=rect.y + _click_rect_offset(context, "offsetY"),
            width=rect.width + _click_rect_offset(context, "offsetWidth"),
            height=rect.height + _click_rect_offset(context, "offsetHeight"),
            coordinate_space_id=rect.coordinate_space_id,
            source_generation=rect.source_generation,
        )
        if (
            adjusted_rect.x < 0
            or adjusted_rect.y < 0
            or adjusted_rect.width <= 0
            or adjusted_rect.height <= 0
        ):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.COORDINATE_OUT_OF_BOUNDS,
                parameter_name="rectOffset",
            )
        async with self._lease_provider.lease(
            context.device_key,
            context.cancellation,
        ):
            context.cancellation.raise_if_cancelled()
            try:
                await self._backend.click_rect_center(
                    context.device_key,
                    adjusted_rect,
                    context.cancellation,
                    context.operation_correlation(),
                )
            except DeviceServiceError as error:
                raise _device_action_failure(error) from error
        return NodeExecutionResult(
            outputs={"clicked": True},
            selected_execution_outputs=("next",),
        )


def _click_rect_offset(context: NodeExecutionContext, property_name: str) -> int:
    if property_name in context.inputs:
        value = context.require_number(property_name)
        if not value.is_integer() or not -65_536 <= value <= 65_536:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=property_name,
            )
        return int(value)
    raw_value = context.properties.get(property_name, 0)
    if isinstance(raw_value, bool) or not isinstance(raw_value, int | float):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    value = float(raw_value)
    if (
        not math.isfinite(value)
        or not value.is_integer()
        or not -65_536 <= value <= 65_536
    ):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    return int(value)


CLICK_POINT_MODES = (
    "point",
    "coordinates",
    "randomPoints",
    "sequentialPoints",
    "rectCenter",
    "rectRandom",
)


def _click_point_mode(context: NodeExecutionContext) -> str:
    value = context.properties.get("inputMode", "point")
    if not isinstance(value, str) or value not in CLICK_POINT_MODES:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="inputMode",
        )
    return value


def _click_interval_milliseconds(context: NodeExecutionContext) -> int:
    value = context.properties.get("intervalMilliseconds", 100)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="intervalMilliseconds",
        )
    number = float(value)
    if (
        not math.isfinite(number)
        or not number.is_integer()
        or not 0 <= number <= 60_000
    ):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="intervalMilliseconds",
        )
    return int(number)


def _random_index(length: int) -> int:
    """Select a bounded index through one narrow seam that tests can control."""

    if length < 1:
        raise ValueError("Random selection requires at least one item.")
    value = random.random()
    if not math.isfinite(value) or not 0 <= value < 1:
        raise ValueError("Random selection must return a value in [0, 1).")
    return min(int(value * length), length - 1)


def _validated_click_rect(context: NodeExecutionContext) -> RuntimeRect:
    rect = context.require_rect("rect")
    coordinates = (rect.x, rect.y, rect.width, rect.height)
    if (
        any(
            isinstance(value, bool) or not isinstance(value, int)
            for value in coordinates
        )
        or rect.x < 0
        or rect.y < 0
        or rect.width < 1
        or rect.height < 1
    ):
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.INPUT_TYPE_INVALID,
            parameter_name="rect",
        )
    return rect


def _rect_center_point(rect: RuntimeRect) -> RuntimePoint:
    return RuntimePoint(
        x=rect.x + rect.width // 2,
        y=rect.y + rect.height // 2,
        coordinate_space_id=rect.coordinate_space_id,
        source_generation=rect.source_generation,
    )


def _rect_random_point(rect: RuntimeRect) -> RuntimePoint:
    return RuntimePoint(
        x=rect.x + _random_index(rect.width),
        y=rect.y + _random_index(rect.height),
        coordinate_space_id=rect.coordinate_space_id,
        source_generation=rect.source_generation,
    )


class _ClickPointExecutor:
    type_key = "automation.clickPoint"

    def __init__(
        self,
        backend: PointClickBackend,
        lease_provider: DeviceLeaseProvider,
    ) -> None:
        self._backend = backend
        self._lease_provider = lease_provider

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        mode = _click_point_mode(context)
        interval_milliseconds = (
            _click_interval_milliseconds(context) if mode == "sequentialPoints" else 0
        )
        selected_index = 1
        if mode == "point":
            points = (context.require_point("point"),)
        elif mode == "coordinates":
            points = (_bound_point(context),)
        elif mode == "randomPoints":
            available = context.require_points("points")
            selected_index = _random_index(len(available)) + 1
            points = (available[selected_index - 1],)
        elif mode == "sequentialPoints":
            points = context.require_points("points")
            selected_index = 0
        elif mode == "rectCenter":
            points = (_rect_center_point(_validated_click_rect(context)),)
        else:
            points = (_rect_random_point(_validated_click_rect(context)),)

        async with self._lease_provider.lease(
            context.device_key,
            context.cancellation,
        ):
            for index, point in enumerate(points):
                if index > 0:
                    await cancellable_delay(
                        interval_milliseconds / 1000,
                        context.cancellation,
                    )
                context.cancellation.raise_if_cancelled()
                try:
                    await self._backend.click_point(
                        context.device_key,
                        point,
                        context.cancellation,
                        context.operation_correlation(),
                    )
                except DeviceServiceError as error:
                    raise _device_action_failure(error) from error
        return NodeExecutionResult(
            outputs={
                "clicked": True,
                "clickedCount": len(points),
                "selectedIndex": selected_index,
            },
            selected_execution_outputs=("next",),
        )


class _LaunchAndroidAppExecutor:
    type_key = "automation.launchAndroidApp"

    def __init__(
        self,
        backend: AndroidAppLaunchBackend,
        lease_provider: DeviceLeaseProvider,
    ) -> None:
        self._backend = backend
        self._lease_provider = lease_provider

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        intent = context.property_string("intent")
        try:
            validate_android_intent(intent)
        except ValueError as error:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="intent",
            ) from error
        async with self._lease_provider.lease(
            context.device_key,
            context.cancellation,
        ):
            context.cancellation.raise_if_cancelled()
            try:
                await self._backend.launch_android_app(
                    context.device_key,
                    intent,
                    context.cancellation,
                    context.operation_correlation(),
                )
            except DeviceServiceError as error:
                raise _device_action_failure(error) from error
        return NodeExecutionResult(
            outputs={"launched": True},
            selected_execution_outputs=("next",),
        )


class _PressAndroidKeyExecutor:
    type_key = "automation.pressAndroidKey"

    def __init__(
        self,
        backend: AndroidKeyBackend,
        lease_provider: DeviceLeaseProvider,
    ) -> None:
        self._backend = backend
        self._lease_provider = lease_provider

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        key_value = context.property_string("key")
        try:
            key = AndroidKey(key_value)
        except ValueError as error:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="key",
            ) from error
        async with self._lease_provider.lease(
            context.device_key,
            context.cancellation,
        ):
            context.cancellation.raise_if_cancelled()
            try:
                await self._backend.press_android_key(
                    context.device_key,
                    key,
                    context.cancellation,
                    context.operation_correlation(),
                )
            except DeviceServiceError as error:
                raise _device_action_failure(error) from error
        return NodeExecutionResult(
            outputs={"pressed": True},
            selected_execution_outputs=("next",),
        )


class _SwipeExecutor:
    type_key = "automation.swipe"

    def __init__(
        self,
        backend: TouchActionBackend,
        lease_provider: DeviceLeaseProvider,
    ) -> None:
        self._backend = backend
        self._lease_provider = lease_provider

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        start = context.require_point("start")
        end = context.require_point("end")
        duration = _touch_duration(context, "durationMilliseconds")
        async with self._lease_provider.lease(
            context.device_key,
            context.cancellation,
        ):
            context.cancellation.raise_if_cancelled()
            try:
                await self._backend.swipe(
                    context.device_key,
                    start,
                    end,
                    duration,
                    context.cancellation,
                    context.operation_correlation(),
                )
            except DeviceServiceError as error:
                raise _device_action_failure(error) from error
        return NodeExecutionResult(
            outputs={"completed": True},
            selected_execution_outputs=("next",),
        )


class _TouchActionExecutor:
    type_key = "automation.touchAction"

    def __init__(
        self,
        backend: AutomationBackend,
        lease_provider: DeviceLeaseProvider,
    ) -> None:
        self._backend = backend
        self._lease_provider = lease_provider

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        action_type = context.property_string("actionType")
        start = context.require_point("start")
        async with self._lease_provider.lease(
            context.device_key,
            context.cancellation,
        ):
            context.cancellation.raise_if_cancelled()
            try:
                if action_type == "click":
                    await self._backend.click_point(
                        context.device_key,
                        start,
                        context.cancellation,
                        context.operation_correlation(),
                    )
                elif action_type == "longPress":
                    await self._backend.long_press(
                        context.device_key,
                        start,
                        _touch_duration(context, "longPressDurationMilliseconds"),
                        context.cancellation,
                        context.operation_correlation(),
                    )
                elif action_type == "swipe":
                    await self._backend.swipe(
                        context.device_key,
                        start,
                        context.require_point("end"),
                        _touch_duration(context, "swipeDurationMilliseconds"),
                        context.cancellation,
                        context.operation_correlation(),
                    )
                elif action_type == "multiSwipe":
                    duration = _touch_duration(
                        context,
                        "swipeDurationMilliseconds",
                    )
                    start_delay = _touch_delay(
                        context,
                        "secondaryStartDelayMilliseconds",
                        duration,
                    )
                    await self._backend.multi_swipe(
                        context.device_key,
                        start,
                        context.require_point("end"),
                        context.require_point("secondaryStart"),
                        context.require_point("secondaryEnd"),
                        duration,
                        start_delay,
                        context.cancellation,
                        context.operation_correlation(),
                    )
                else:
                    raise NodeExecutionFailure(
                        NodeExecutionFailureCode.PROPERTY_INVALID,
                        parameter_name="actionType",
                    )
            except DeviceServiceError as error:
                raise _device_action_failure(error) from error
        return NodeExecutionResult(
            outputs={"completed": True},
            selected_execution_outputs=("next",),
        )


def _touch_duration(context: NodeExecutionContext, property_name: str) -> int:
    duration = context.property_number(property_name)
    if not duration.is_integer() or duration < 1 or duration > 60_000:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    return int(duration)


def _touch_delay(
    context: NodeExecutionContext,
    property_name: str,
    maximum: int,
) -> int:
    delay = context.property_number(property_name)
    if not delay.is_integer() or delay < 0 or delay > maximum:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name=property_name,
        )
    return int(delay)


def _device_action_failure(error: DeviceServiceError) -> NodeExecutionFailure:
    code = (
        NodeExecutionFailureCode.ACTION_OUTCOME_UNKNOWN
        if error.code is DeviceServiceErrorCode.ACTION_OUTCOME_UNKNOWN
        else NodeExecutionFailureCode.ACTION_FAILED
    )
    return NodeExecutionFailure(
        code,
        can_follow_failure_output=(
            error.code is DeviceServiceErrorCode.ACTION_REJECTED
        ),
    )


class _FakeOcrExecutor:
    type_key = "test.fake.ocr"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        text = context.require_string("fixtureText")
        matched = context.property_bool("matched")
        return NodeExecutionResult(
            outputs={"text": text if matched else "", "matched": matched},
            selected_execution_outputs=("next",),
        )


@dataclass(frozen=True, slots=True)
class FakeActionRecord:
    node_id: UUID
    device_key: str
    label: str


class FakeActionRecorder(Protocol):
    async def record(self, action: FakeActionRecord) -> None: ...


class InMemoryFakeActionRecorder:
    def __init__(self) -> None:
        self._records: list[FakeActionRecord] = []

    @property
    def records(self) -> tuple[FakeActionRecord, ...]:
        return tuple(self._records)

    async def record(self, action: FakeActionRecord) -> None:
        self._records.append(action)


class _FakeActionExecutor:
    type_key = "test.fake.action"

    def __init__(
        self,
        recorder: FakeActionRecorder,
        lease_provider: DeviceLeaseProvider,
    ) -> None:
        self._recorder = recorder
        self._lease_provider = lease_provider

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        label_value = context.inputs.get("label", "")
        if not isinstance(label_value, str) or len(label_value) > 200:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="label",
            )
        if context.device_key is None:
            raise NodeExecutionFailure(NodeExecutionFailureCode.DEVICE_NOT_BOUND)
        async with self._lease_provider.lease(
            context.device_key,
            context.cancellation,
        ):
            context.cancellation.raise_if_cancelled()
            await self._recorder.record(
                FakeActionRecord(context.node_id, context.device_key, label_value)
            )
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult(
            outputs={"recorded": True},
            selected_execution_outputs=("next",),
        )


def build_phase_4_production_registry() -> NodeRegistry:
    builder = NodeRegistryBuilder(PHASE_4_PRODUCTION_NODE_TYPE_KEYS)
    for registration in _production_registrations():
        builder.register(registration)
    builder.add_workflow_template(_compare_and_branch_template())
    return builder.build()


def build_phase_4_test_registry(
    recorder: FakeActionRecorder,
    lease_provider: DeviceLeaseProvider | None = None,
) -> NodeRegistry:
    effective_lease_provider = lease_provider
    if effective_lease_provider is None:
        effective_lease_provider = DeviceLeaseManager()
    builder = NodeRegistryBuilder(
        PHASE_4_PRODUCTION_NODE_TYPE_KEYS | TEST_NODE_TYPE_KEYS
    )
    for registration in _production_registrations():
        builder.register(registration)
    builder.register(NodeRegistration(_fake_ocr_definition(), _FakeOcrExecutor()))
    builder.register(
        NodeRegistration(
            _fake_action_definition(),
            _FakeActionExecutor(
                recorder=recorder,
                lease_provider=effective_lease_provider,
            ),
        )
    )
    builder.add_workflow_template(_compare_and_branch_template())
    return builder.build()


def build_phase_4_fake_backend_registry(
    backend: AutomationBackend,
    lease_provider: DeviceLeaseProvider | None = None,
) -> NodeRegistry:
    effective_lease_provider = lease_provider or DeviceLeaseManager()
    builder = NodeRegistryBuilder(MVP_PRODUCTION_NODE_TYPE_KEYS)
    for registration in _production_registrations():
        builder.register(registration)
    for registration in _automation_registrations(
        backend,
        effective_lease_provider,
    ):
        builder.register(registration)
    builder.add_workflow_template(_compare_and_branch_template())
    builder.add_workflow_template(_recognize_number_and_branch_template())
    builder.add_workflow_template(_capture_and_click_point_template())
    return builder.build()


def build_capture_backend_registry(
    backend: ScreenCaptureBackend,
) -> NodeRegistry:
    builder = NodeRegistryBuilder(
        PHASE_4_PRODUCTION_NODE_TYPE_KEYS | {"automation.captureScreen"}
    )
    for registration in _production_registrations():
        builder.register(registration)
    builder.register(
        NodeRegistration(
            _capture_screen_definition(),
            _CaptureScreenExecutor(backend),
        )
    )
    builder.add_workflow_template(_compare_and_branch_template())
    return builder.build()


def build_capture_and_ocr_backend_registry(
    backend: CaptureAndOcrBackend,
) -> NodeRegistry:
    builder = NodeRegistryBuilder(
        PHASE_4_PRODUCTION_NODE_TYPE_KEYS | {"automation.captureScreen", "vision.ocr"}
    )
    for registration in _production_registrations():
        builder.register(registration)
    builder.register(
        NodeRegistration(
            _capture_screen_definition(),
            _CaptureScreenExecutor(backend),
        )
    )
    builder.register(NodeRegistration(_ocr_definition(), _OcrExecutor(backend)))
    builder.add_workflow_template(_compare_and_branch_template())
    builder.add_workflow_template(_recognize_number_and_branch_template())
    return builder.build()


def build_mvp_production_registry() -> NodeRegistry:
    """Builds the complete reviewed node catalog without claiming a backend exists."""

    builder = NodeRegistryBuilder(MVP_PRODUCTION_NODE_TYPE_KEYS)
    for registration in _production_registrations():
        builder.register(registration)
    for registration in _unavailable_maa_registrations():
        builder.register(registration)
    builder.add_workflow_template(_compare_and_branch_template())
    builder.add_workflow_template(_recognize_number_and_branch_template())
    builder.add_workflow_template(_capture_and_click_point_template())
    builder.add_workflow_template(_image_recognition_group_template())
    builder.add_workflow_template(_text_recognition_group_template())
    return builder.build()


def build_maa_backend_registry(
    backend: AutomationBackend,
    *,
    include_ocr: bool,
) -> NodeRegistry:
    recognition_backend = cast(ClassicalRecognitionBackend, backend)
    builder = NodeRegistryBuilder(MVP_PRODUCTION_NODE_TYPE_KEYS)
    lease_provider = DeviceLeaseManager()
    for registration in _production_registrations():
        builder.register(registration)
    builder.register(
        NodeRegistration(
            _capture_screen_definition(),
            _CaptureScreenExecutor(backend),
        )
    )
    builder.register(
        NodeRegistration(
            _ocr_definition(),
            (
                _OcrExecutor(backend)
                if include_ocr
                else _UnavailableCapabilityExecutor("vision.ocr")
            ),
        )
    )
    builder.register(
        NodeRegistration(
            _template_match_definition(),
            _TemplateMatchExecutor(recognition_backend),
        )
    )
    builder.register(
        NodeRegistration(
            _feature_match_definition(),
            _FeatureMatchExecutor(recognition_backend),
        )
    )
    builder.register(
        NodeRegistration(
            _color_match_definition(),
            _ColorMatchExecutor(recognition_backend),
        )
    )
    builder.register(
        NodeRegistration(
            _click_point_definition(),
            _ClickPointExecutor(backend, lease_provider),
        )
    )
    builder.register(
        NodeRegistration(
            _click_rect_center_definition(),
            _ClickRectCenterExecutor(backend, lease_provider),
        )
    )
    builder.register(
        NodeRegistration(
            _touch_action_definition(),
            _TouchActionExecutor(backend, lease_provider),
        )
    )
    builder.register(
        NodeRegistration(
            _launch_android_app_definition(),
            _LaunchAndroidAppExecutor(backend, lease_provider),
        )
    )
    builder.register(
        NodeRegistration(
            _press_android_key_definition(),
            _PressAndroidKeyExecutor(backend, lease_provider),
        )
    )
    builder.register(
        NodeRegistration(
            _swipe_definition(),
            _SwipeExecutor(backend, lease_provider),
        )
    )
    builder.add_workflow_template(_compare_and_branch_template())
    builder.add_workflow_template(_recognize_number_and_branch_template())
    builder.add_workflow_template(_capture_and_click_point_template())
    builder.add_workflow_template(_image_recognition_group_template())
    builder.add_workflow_template(_text_recognition_group_template())
    return builder.build()


def _production_registrations() -> tuple[NodeRegistration, ...]:
    return (
        NodeRegistration(_start_definition(), _StartExecutor()),
        NodeRegistration(_stop_definition(), _StopExecutor()),
        NodeRegistration(_end_path_definition(), _EndPathExecutor()),
        NodeRegistration(_sequence_definition(), _SequenceExecutor()),
        NodeRegistration(_sequence_order_definition(), _SequenceOrderExecutor()),
        NodeRegistration(_run_counter_definition(), _RunCounterExecutor()),
        NodeRegistration(_bounded_retry_definition(), _BoundedRetryExecutor()),
        NodeRegistration(_task_choice_definition(), _TaskChoiceExecutor()),
        NodeRegistration(
            _case_overlay_definition(
                "core.logic.caseOverlayBool",
                "bool",
                fallback_required=True,
            ),
            _CaseOverlayExecutor("core.logic.caseOverlayBool", "bool", True),
        ),
        NodeRegistration(
            _case_overlay_definition(
                "core.logic.caseOverlayNumber",
                "number",
                fallback_required=True,
            ),
            _CaseOverlayExecutor("core.logic.caseOverlayNumber", "number", True),
        ),
        NodeRegistration(
            _case_overlay_definition(
                "core.logic.caseOverlayImageRef",
                "imageRef",
                fallback_required=False,
            ),
            _CaseOverlayExecutor("core.logic.caseOverlayImageRef", "imageRef", False),
        ),
        NodeRegistration(_parallel_definition(), _ParallelExecutor()),
        NodeRegistration(_branch_definition(), _BranchExecutor()),
        NodeRegistration(_number_select_definition(), _NumberSelectExecutor()),
        NodeRegistration(_number_compare_definition(), _NumberCompareExecutor()),
        NodeRegistration(
            _numeric_expression_definition(),
            _NumericExpressionExecutor(),
        ),
        NodeRegistration(_image_list_definition(), _ImageListExecutor()),
        NodeRegistration(_region_list_definition(), _RegionListExecutor()),
        NodeRegistration(_point_list_definition(), _PointListExecutor()),
        NodeRegistration(_arithmetic_definition(), _ArithmeticExecutor()),
        NodeRegistration(_number_literal_definition(), _NumberLiteralExecutor()),
        NodeRegistration(_string_literal_definition(), _StringLiteralExecutor()),
        NodeRegistration(
            _project_image_asset_definition(),
            _ProjectImageAssetExecutor(),
        ),
        NodeRegistration(_point_definition(), _PointExecutor()),
        NodeRegistration(_rectangle_definition(), _RectangleExecutor()),
        NodeRegistration(_delay_definition(), _DelayExecutor()),
        NodeRegistration(_log_definition(), _LogExecutor()),
        NodeRegistration(_parse_number_definition(), _ParseNumberExecutor()),
        NodeRegistration(_read_text_definition(), _ReadTextExecutor()),
        NodeRegistration(_read_number_definition(), _ReadNumberExecutor()),
        NodeRegistration(_read_value_definition(), _ReadValueExecutor()),
        *build_variable_registrations(),
    )


def _automation_registrations(
    backend: AutomationBackend,
    lease_provider: DeviceLeaseProvider,
) -> tuple[NodeRegistration, ...]:
    return (
        NodeRegistration(
            _capture_screen_definition(),
            _CaptureScreenExecutor(backend),
        ),
        NodeRegistration(_ocr_definition(), _OcrExecutor(backend)),
        NodeRegistration(
            _click_point_definition(),
            _ClickPointExecutor(backend, lease_provider),
        ),
        NodeRegistration(
            _click_rect_center_definition(),
            _ClickRectCenterExecutor(backend, lease_provider),
        ),
        NodeRegistration(
            _touch_action_definition(),
            _TouchActionExecutor(backend, lease_provider),
        ),
        NodeRegistration(
            _launch_android_app_definition(),
            _LaunchAndroidAppExecutor(backend, lease_provider),
        ),
        NodeRegistration(
            _press_android_key_definition(),
            _PressAndroidKeyExecutor(backend, lease_provider),
        ),
        NodeRegistration(
            _swipe_definition(),
            _SwipeExecutor(backend, lease_provider),
        ),
    )


def _unavailable_maa_registrations() -> tuple[NodeRegistration, ...]:
    definitions = (
        _capture_screen_definition(),
        _ocr_definition(),
        _template_match_definition(),
        _feature_match_definition(),
        _color_match_definition(),
        _click_point_definition(),
        _click_rect_center_definition(),
        _touch_action_definition(),
        _launch_android_app_definition(),
        _press_android_key_definition(),
        _swipe_definition(),
    )
    return tuple(
        NodeRegistration(
            definition,
            _UnavailableCapabilityExecutor(definition.type_key.root),
        )
        for definition in definitions
    )


def _definition(
    *,
    type_key: str,
    runtime_kind: str,
    side_effect: str,
    category: str,
    icon_key: str,
    ports: list[dict[str, object]],
    property_schema: dict[str, object] | None = None,
    property_defaults: dict[str, object] | None = None,
    required_capabilities: list[str] | None = None,
) -> NodeDefinitionV1:
    key_prefix = f"node.{type_key}"
    return NodeDefinitionV1.model_validate(
        {
            "typeKey": type_key,
            "typeVersion": 1,
            "runtimeKind": runtime_kind,
            "sideEffect": side_effect,
            "category": category,
            "titleKey": f"{key_prefix}.title",
            "descriptionKey": f"{key_prefix}.description",
            "iconKey": icon_key,
            "ports": ports,
            **({"propertySchema": property_schema} if property_schema else {}),
            **({"propertyDefaults": property_defaults} if property_defaults else {}),
            **(
                {"requiredCapabilities": required_capabilities}
                if required_capabilities
                else {}
            ),
        }
    )


def _port(
    port_id: str,
    *,
    direction: str,
    port_kind: str,
    value_type: dict[str, object],
    node_type_key: str,
    required: bool = False,
    accepts_literal: bool = False,
    allows_fan_out: bool = False,
) -> dict[str, object]:
    return {
        "portId": port_id,
        "direction": direction,
        "portKind": port_kind,
        "type": value_type,
        "labelKey": f"node.{node_type_key}.port.{port_id}",
        **({"required": True} if required else {}),
        **({"acceptsLiteral": True} if accepts_literal else {}),
        **({"allowsFanOut": True} if allows_fan_out else {}),
    }


def _exec_port(
    port_id: str,
    direction: str,
    node_type_key: str,
    *,
    allows_fan_out: bool = False,
) -> dict[str, object]:
    return _port(
        port_id,
        direction=direction,
        port_kind="execution",
        value_type={"kind": "exec"},
        node_type_key=node_type_key,
        allows_fan_out=allows_fan_out,
    )


def _data_port(
    port_id: str,
    direction: str,
    value_kind: str,
    node_type_key: str,
    *,
    required: bool = False,
    accepts_literal: bool = False,
) -> dict[str, object]:
    return _port(
        port_id,
        direction=direction,
        port_kind="data",
        value_type={"kind": value_kind},
        node_type_key=node_type_key,
        required=required,
        accepts_literal=accepts_literal,
    )


def _collection_port(
    port_id: str,
    direction: str,
    element_kind: str,
    node_type_key: str,
    *,
    allows_fan_out: bool = False,
) -> dict[str, object]:
    return _port(
        port_id,
        direction=direction,
        port_kind="data",
        value_type={"kind": "collection", "element": {"kind": element_kind}},
        node_type_key=node_type_key,
        allows_fan_out=allows_fan_out,
    )


def _start_definition() -> NodeDefinitionV1:
    type_key = "core.flow.start"
    return _definition(
        type_key=type_key,
        runtime_kind="entry",
        side_effect="none",
        category="flow",
        icon_key="run.start",
        ports=[_exec_port("next", "output", type_key)],
    )


def _stop_definition() -> NodeDefinitionV1:
    type_key = "core.flow.stop"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="runtime",
        category="flow",
        icon_key="run.stop",
        ports=[_exec_port("run", "input", type_key)],
    )


def _end_path_definition() -> NodeDefinitionV1:
    type_key = "core.flow.endPath"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="runtime",
        category="flow",
        icon_key="run.stop",
        ports=[_exec_port("run", "input", type_key)],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["scope"],
            "properties": {
                "scope": _choice_property(type_key, "scope", ["current", "all"]),
            },
        },
        property_defaults={"scope": "current"},
    )


def _sequence_definition() -> NodeDefinitionV1:
    type_key = "core.flow.sequence"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="none",
        category="flow",
        icon_key="category.flow",
        ports=[
            _exec_port("run", "input", type_key),
            _collection_port("order", "input", "string", type_key),
            _exec_port("steps", "output", type_key, allows_fan_out=True),
            *[_exec_port(f"step{index}", "output", type_key) for index in range(1, 17)],
        ],
    )


def _sequence_order_definition() -> NodeDefinitionV1:
    type_key = "core.flow.sequenceOrder"
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="flow",
        icon_key="category.flow",
        ports=[
            _collection_port(
                "order",
                "output",
                "string",
                type_key,
                allows_fan_out=True,
            ),
        ],
    )


def _run_counter_definition() -> NodeDefinitionV1:
    type_key = "core.flow.runCounter"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="runtime",
        category="flow",
        icon_key="category.flow",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port(
                "targetCount",
                "input",
                "number",
                type_key,
                required=True,
                accepts_literal=True,
            ),
            _data_port("currentCount", "output", "number", type_key),
            _exec_port("reached", "output", type_key),
            _exec_port("notReached", "output", type_key),
        ],
    )


def _bounded_retry_definition() -> NodeDefinitionV1:
    type_key = "core.flow.boundedRetry"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="runtime",
        category="timing",
        icon_key="node.delay",
        ports=[
            _exec_port("run", "input", type_key),
            _exec_port("attempt", "output", type_key),
            _exec_port("exhausted", "output", type_key),
            _data_port("attemptNumber", "output", "number", type_key),
            _data_port("elapsedMilliseconds", "output", "number", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": [
                "timeoutMilliseconds",
                "rateLimitMilliseconds",
                "maximumAttempts",
            ],
            "properties": {
                "timeoutMilliseconds": {
                    "type": "integer",
                    "minimum": BOUNDED_RETRY_MINIMUM_TIMEOUT_MILLISECONDS,
                    "maximum": BOUNDED_RETRY_MAXIMUM_TIMEOUT_MILLISECONDS,
                    "x-rinoLabelKey": (
                        f"node.{type_key}.property.timeoutMilliseconds.label"
                    ),
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.timeoutMilliseconds.description"
                    ),
                },
                "rateLimitMilliseconds": {
                    "type": "integer",
                    "minimum": BOUNDED_RETRY_MINIMUM_RATE_LIMIT_MILLISECONDS,
                    "maximum": BOUNDED_RETRY_MAXIMUM_RATE_LIMIT_MILLISECONDS,
                    "x-rinoLabelKey": (
                        f"node.{type_key}.property.rateLimitMilliseconds.label"
                    ),
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.rateLimitMilliseconds.description"
                    ),
                },
                "maximumAttempts": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": BOUNDED_RETRY_MAXIMUM_ATTEMPTS,
                    "x-rinoLabelKey": (
                        f"node.{type_key}.property.maximumAttempts.label"
                    ),
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.maximumAttempts.description"
                    ),
                },
            },
        },
        property_defaults={
            "timeoutMilliseconds": 20_000,
            "rateLimitMilliseconds": 1_000,
            "maximumAttempts": 20,
        },
    )


def _task_choice_definition() -> NodeDefinitionV1:
    type_key = TASK_CHOICE_TYPE_KEY
    case_ports: list[dict[str, object]] = []
    for index in range(1, 17):
        case_port = _exec_port(f"case{index}", "output", type_key)
        case_port["labelKey"] = f"node.{type_key}.port.case"
        case_ports.append(case_port)
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="none",
        category="logic",
        icon_key="node.branch",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("selectedCaseId", "output", "string", type_key),
            *case_ports,
            _exec_port("unmatched", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["selectedCaseId", "settingKey", "exposeInTaskSettings"],
            "properties": {
                "selectedCaseId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "x-rinoLabelKey": f"node.{type_key}.property.selectedCaseId.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.selectedCaseId.description"
                    ),
                },
                "settingKey": {
                    "type": "string",
                    "pattern": r"^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*$",
                    "maxLength": 64,
                    "x-rinoLabelKey": f"node.{type_key}.property.settingKey.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.settingKey.description"
                    ),
                },
                "exposeInTaskSettings": _boolean_property(
                    type_key, "exposeInTaskSettings"
                ),
            },
        },
        property_defaults={
            "selectedCaseId": "case1",
            "settingKey": "taskChoice",
            "exposeInTaskSettings": True,
        },
    )


def _case_overlay_definition(
    type_key: str,
    value_kind: str,
    *,
    fallback_required: bool,
) -> NodeDefinitionV1:
    case_ports = [
        _data_port(f"case{index}", "input", value_kind, type_key)
        for index in range(1, 17)
    ]
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="logic",
        icon_key="node.branch",
        ports=[
            _data_port("selectedCaseId", "input", "string", type_key, required=True),
            _data_port(
                "fallback",
                "input",
                value_kind,
                type_key,
                required=fallback_required,
            ),
            *case_ports,
            _data_port("value", "output", value_kind, type_key),
        ],
    )


def _parallel_definition() -> NodeDefinitionV1:
    type_key = "core.flow.parallel"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="none",
        category="flow",
        icon_key="category.flow",
        ports=[
            _exec_port("run", "input", type_key),
            _exec_port("branch1", "output", type_key),
            _exec_port("branch2", "output", type_key),
            _exec_port("branch3", "output", type_key),
        ],
    )


def _branch_definition() -> NodeDefinitionV1:
    type_key = "core.logic.branch"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="none",
        category="logic",
        icon_key="node.branch",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port(
                "condition",
                "input",
                "bool",
                type_key,
                required=True,
                accepts_literal=True,
            ),
            _exec_port("whenTrue", "output", type_key),
            _exec_port("whenFalse", "output", type_key),
        ],
    )


def _number_compare_definition() -> NodeDefinitionV1:
    type_key = "core.logic.numberCompare"
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="logic",
        icon_key="node.compare",
        ports=[
            _data_port(
                "left",
                "input",
                "number",
                type_key,
                required=True,
                accepts_literal=True,
            ),
            _data_port(
                "right",
                "input",
                "number",
                type_key,
                required=True,
                accepts_literal=True,
            ),
            _data_port("result", "output", "bool", type_key),
            _data_port("relation", "output", "string", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["operator"],
            "properties": {
                "operator": _choice_property(
                    type_key,
                    "operator",
                    [
                        "greaterThan",
                        "greaterThanOrEqual",
                        "lessThan",
                        "lessThanOrEqual",
                        "equalTo",
                        "notEqualTo",
                    ],
                ),
            },
        },
        property_defaults={"operator": "greaterThan"},
    )


def _number_select_definition() -> NodeDefinitionV1:
    type_key = "core.logic.numberSelect"
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="logic",
        icon_key="node.compare",
        ports=[
            *[
                _data_port(
                    port_id,
                    "input",
                    "number",
                    type_key,
                    accepts_literal=True,
                )
                for port_id in NUMERIC_INPUT_PORT_IDS
            ],
            _data_port("value", "output", "number", type_key),
            _data_port("condition", "output", "string", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["mode"],
            "properties": {
                "mode": _choice_property(
                    type_key,
                    "mode",
                    ["maximum", "minimum"],
                )
            },
        },
        property_defaults={"mode": "maximum"},
    )


def _numeric_expression_definition() -> NodeDefinitionV1:
    type_key = "core.math.expression"
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="logic",
        icon_key="node.compare",
        ports=[
            *[
                _data_port(
                    port_id,
                    "input",
                    "number",
                    type_key,
                    accepts_literal=True,
                )
                for port_id in NUMERIC_INPUT_PORT_IDS
            ],
            _data_port("result", "output", "number", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["expression"],
            "properties": {
                "expression": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "x-rinoLabelKey": f"node.{type_key}.property.expression.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.expression.description"
                    ),
                }
            },
        },
        property_defaults={"expression": "a + b - c"},
    )


def _image_list_definition() -> NodeDefinitionV1:
    type_key = "core.collection.imageList"
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="vision",
        icon_key="node.imageRecognition",
        ports=[
            *[
                # The authored item count is stored in dynamicPortState.  Keeping
                # these ports optional at the static registry level prevents the
                # graph validator and scheduler from requiring all sixteen
                # bounded slots; the executor validates every active slot.
                _data_port(port_id, "input", "imageRef", type_key)
                for port_id in COLLECTION_ITEM_PORT_IDS
            ],
            _collection_port("images", "output", "imageRef", type_key),
        ],
    )


def _region_list_definition() -> NodeDefinitionV1:
    type_key = "core.collection.regionList"
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="values",
        icon_key="node.coordinate",
        ports=[
            *[
                _data_port(port_id, "input", "rect", type_key)
                for port_id in COLLECTION_ITEM_PORT_IDS
            ],
            _collection_port("regions", "output", "rect", type_key),
        ],
    )


def _point_list_definition() -> NodeDefinitionV1:
    type_key = "core.collection.pointList"
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="values",
        icon_key="node.coordinate",
        ports=[
            *[
                _data_port(port_id, "input", "point", type_key)
                for port_id in COLLECTION_ITEM_PORT_IDS
            ],
            _collection_port("points", "output", "point", type_key),
        ],
    )


def _arithmetic_definition() -> NodeDefinitionV1:
    type_key = "core.math.arithmetic"
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="logic",
        icon_key="node.compare",
        ports=[
            _data_port(
                "left",
                "input",
                "number",
                type_key,
                required=True,
                accepts_literal=True,
            ),
            _data_port(
                "right",
                "input",
                "number",
                type_key,
                required=True,
                accepts_literal=True,
            ),
            _data_port("result", "output", "number", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["operator"],
            "properties": {
                "operator": _choice_property(
                    type_key,
                    "operator",
                    ["add", "subtract", "multiply", "divide"],
                )
            },
        },
        property_defaults={"operator": "add"},
    )


def _number_literal_definition() -> NodeDefinitionV1:
    return _literal_definition(
        type_key="core.value.numberLiteral",
        value_kind="number",
        default_value=0,
    )


def _string_literal_definition() -> NodeDefinitionV1:
    return _literal_definition(
        type_key="core.value.stringLiteral",
        value_kind="string",
        default_value="",
    )


def _project_image_asset_definition() -> NodeDefinitionV1:
    type_key = "core.image.projectAsset"
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="values",
        icon_key="node.imageRecognition",
        ports=[_data_port("image", "output", "imageRef", type_key)],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["assetId"],
            "properties": {
                "assetId": {
                    "type": "string",
                    "format": "uuid",
                    "x-rinoLabelKey": f"node.{type_key}.property.assetId.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.assetId.description"
                    ),
                }
            },
        },
    )


def _point_definition() -> NodeDefinitionV1:
    type_key = "core.geometry.point"
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="values",
        icon_key="node.coordinate",
        ports=[
            _data_port("image", "input", "imageRef", type_key, required=True),
            _coordinate_input_port("x", type_key),
            _coordinate_input_port("y", type_key),
            _reference_dimension_port("referenceWidth", type_key),
            _reference_dimension_port("referenceHeight", type_key),
            _data_port("point", "output", "point", type_key),
        ],
    )


def _rectangle_definition() -> NodeDefinitionV1:
    type_key = "core.geometry.rectangle"
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="values",
        icon_key="node.coordinate",
        ports=[
            _data_port("image", "input", "imageRef", type_key, required=True),
            _coordinate_input_port("x", type_key),
            _coordinate_input_port("y", type_key),
            _coordinate_input_port("width", type_key),
            _coordinate_input_port("height", type_key),
            _reference_dimension_port("referenceWidth", type_key),
            _reference_dimension_port("referenceHeight", type_key),
            _data_port("rectangle", "output", "rect", type_key),
        ],
    )


def _coordinate_input_port(
    port_id: str,
    type_key: str,
) -> dict[str, object]:
    return _data_port(
        port_id,
        "input",
        "number",
        type_key,
        required=True,
        accepts_literal=True,
    )


def _reference_dimension_port(
    port_id: str,
    type_key: str,
) -> dict[str, object]:
    return _coordinate_input_port(port_id, type_key)


def _direct_coordinate_input_port(
    port_id: str,
    type_key: str,
) -> dict[str, object]:
    return _data_port(
        port_id,
        "input",
        "number",
        type_key,
        accepts_literal=True,
    )


def _literal_definition(
    *, type_key: str, value_kind: str, default_value: object
) -> NodeDefinitionV1:
    property_definition: dict[str, object] = {
        "type": value_kind,
        "x-rinoLabelKey": f"node.{type_key}.property.value.label",
        "x-rinoDescriptionKey": f"node.{type_key}.property.value.description",
    }
    if value_kind == "string":
        property_definition["maxLength"] = 65_536
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        category="values",
        icon_key="node.variable",
        ports=[_data_port("value", "output", value_kind, type_key)],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["value"],
            "properties": {"value": property_definition},
        },
        property_defaults={"value": default_value},
    )


def _delay_definition() -> NodeDefinitionV1:
    type_key = "core.time.delay"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="runtime",
        category="timing",
        icon_key="node.delay",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port(
                "durationMilliseconds",
                "input",
                "number",
                type_key,
                required=True,
                accepts_literal=True,
            ),
            _exec_port("next", "output", type_key),
        ],
    )


def _log_definition() -> NodeDefinitionV1:
    type_key = "core.diagnostic.log"
    segment_ports: list[dict[str, object]] = []
    for index in range(1, 17):
        segment_ports.extend(
            [
                _data_port(
                    f"textPart{index}",
                    "input",
                    "string",
                    type_key,
                    accepts_literal=True,
                ),
                _data_port(
                    f"numberPart{index}",
                    "input",
                    "number",
                    type_key,
                    accepts_literal=True,
                ),
            ]
        )
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="diagnostic",
        category="diagnostics",
        icon_key="node.log",
        ports=[
            _exec_port("run", "input", type_key),
            *segment_ports,
            _data_port(
                "message",
                "input",
                "string",
                type_key,
                accepts_literal=True,
            ),
            _exec_port("next", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "segmentKinds": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 16,
                    "items": {"type": "string", "enum": ["text", "number"]},
                    "x-rinoLabelKey": f"node.{type_key}.property.segmentKinds.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.segmentKinds.description"
                    ),
                },
                "appendNewline": {
                    "type": "boolean",
                    "x-rinoLabelKey": f"node.{type_key}.property.appendNewline.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.appendNewline.description"
                    ),
                },
            },
        },
        property_defaults={"appendNewline": False},
    )


def _parse_number_definition() -> NodeDefinitionV1:
    type_key = "text.parseNumber"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="none",
        category="text",
        icon_key="node.compare",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port(
                "text",
                "input",
                "string",
                type_key,
                required=True,
                accepts_literal=True,
            ),
            _data_port("number", "output", "number", type_key),
            _data_port("normalizedText", "output", "string", type_key),
            _exec_port("parsed", "output", type_key),
            _exec_port("invalid", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": [
                "decimalSeparator",
                "groupingSeparator",
                "normalizeFullWidth",
                "allowSign",
            ],
            "properties": {
                "decimalSeparator": {
                    "type": "string",
                    "enum": [".", ","],
                    "x-rinoLabelKey": (
                        f"node.{type_key}.property.decimalSeparator.label"
                    ),
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.decimalSeparator.description"
                    ),
                },
                "groupingSeparator": {
                    "type": "string",
                    "enum": ["", ".", ",", " "],
                    "x-rinoLabelKey": (
                        f"node.{type_key}.property.groupingSeparator.label"
                    ),
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.groupingSeparator.description"
                    ),
                },
                "normalizeFullWidth": {
                    "type": "boolean",
                    "x-rinoLabelKey": (
                        f"node.{type_key}.property.normalizeFullWidth.label"
                    ),
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.normalizeFullWidth.description"
                    ),
                },
                "allowSign": {
                    "type": "boolean",
                    "x-rinoLabelKey": f"node.{type_key}.property.allowSign.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.allowSign.description"
                    ),
                },
                "minimum": {
                    "type": "number",
                    "x-rinoLabelKey": f"node.{type_key}.property.minimum.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.minimum.description"
                    ),
                },
                "maximum": {
                    "type": "number",
                    "x-rinoLabelKey": f"node.{type_key}.property.maximum.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.maximum.description"
                    ),
                },
            },
        },
        property_defaults={
            "decimalSeparator": ".",
            "groupingSeparator": ",",
            "normalizeFullWidth": False,
            "allowSign": True,
        },
    )


def _read_text_definition() -> NodeDefinitionV1:
    type_key = "text.readText"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="none",
        category="text",
        icon_key="node.ocr",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("result", "input", "ocrResult", type_key, required=True),
            _data_port("text", "output", "string", type_key),
            _data_port("rect", "output", "rect", type_key),
            _exec_port("selected", "output", type_key),
            _exec_port("missing", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["candidateIndex", "readingOrder"],
            "properties": _candidate_selection_properties(type_key),
        },
        property_defaults=_candidate_selection_defaults(),
    )


def _read_number_definition() -> NodeDefinitionV1:
    type_key = "text.readNumber"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="none",
        category="text",
        icon_key="node.compare",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("result", "input", "ocrResult", type_key, required=True),
            _data_port("number", "output", "number", type_key),
            _data_port("normalizedText", "output", "string", type_key),
            _data_port("rect", "output", "rect", type_key),
            _exec_port("selected", "output", type_key),
            _exec_port("missing", "output", type_key),
            _exec_port("invalid", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": [
                "candidateIndex",
                "readingOrder",
                "decimalSeparator",
                "groupingSeparator",
                "normalizeFullWidth",
                "allowSign",
            ],
            "properties": {
                **_candidate_selection_properties(type_key),
                **_number_format_properties(type_key),
            },
        },
        property_defaults={
            **_candidate_selection_defaults(),
            "decimalSeparator": ".",
            "groupingSeparator": ",",
            "normalizeFullWidth": False,
            "allowSign": True,
        },
    )


def _read_value_definition() -> NodeDefinitionV1:
    type_key = "text.readValue"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="none",
        category="text",
        icon_key="node.compare",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("result", "input", "ocrResult", type_key, required=True),
            _data_port("text", "output", "string", type_key),
            _collection_port("texts", "output", "string", type_key),
            _data_port("number", "output", "number", type_key),
            _collection_port("numbers", "output", "number", type_key),
            _data_port("rect", "output", "rect", type_key),
            _collection_port("rects", "output", "rect", type_key),
            _exec_port("selected", "output", type_key),
            _exec_port("missing", "output", type_key),
            _exec_port("invalid", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": [
                "valueMode",
                "numberType",
                "selectionMode",
                "readingOrder",
                "lineIndex",
                "itemIndex",
                "decimalSeparator",
                "groupingSeparator",
                "normalizeFullWidth",
                "allowSign",
            ],
            "properties": {
                "valueMode": _choice_property(
                    type_key,
                    "valueMode",
                    ["text", "number"],
                ),
                "numberType": _choice_property(
                    type_key,
                    "numberType",
                    [
                        "integer",
                        "float",
                        "percentage",
                        "positive",
                        "unsignedInteger",
                    ],
                ),
                "selectionMode": _choice_property(
                    type_key,
                    "selectionMode",
                    ["all", "position"],
                ),
                "readingOrder": _choice_property(
                    type_key,
                    "readingOrder",
                    ["rowMajor", "columnMajor"],
                ),
                "lineIndex": _number_property(
                    type_key,
                    "lineIndex",
                    minimum=1,
                    maximum=256,
                    integer=True,
                ),
                "itemIndex": _number_property(
                    type_key,
                    "itemIndex",
                    minimum=1,
                    maximum=256,
                    integer=True,
                ),
                **_number_format_properties(type_key),
            },
        },
        property_defaults={
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
        },
    )


def _candidate_selection_properties(type_key: str) -> dict[str, object]:
    return {
        "candidateIndex": _number_property(
            type_key,
            "candidateIndex",
            minimum=1,
            maximum=256,
            integer=True,
        ),
        "readingOrder": _choice_property(
            type_key,
            "readingOrder",
            ["rowMajor", "columnMajor"],
        ),
    }


def _candidate_selection_defaults() -> dict[str, object]:
    return {"candidateIndex": 1, "readingOrder": "rowMajor"}


def _number_format_properties(type_key: str) -> dict[str, object]:
    properties: dict[str, object] = {
        "decimalSeparator": {
            "type": "string",
            "enum": [".", ","],
            "x-rinoLabelKey": f"node.{type_key}.property.decimalSeparator.label",
            "x-rinoDescriptionKey": (
                f"node.{type_key}.property.decimalSeparator.description"
            ),
        },
        "groupingSeparator": {
            "type": "string",
            "enum": ["", ".", ",", " "],
            "x-rinoLabelKey": f"node.{type_key}.property.groupingSeparator.label",
            "x-rinoDescriptionKey": (
                f"node.{type_key}.property.groupingSeparator.description"
            ),
        },
        "normalizeFullWidth": _boolean_property(type_key, "normalizeFullWidth"),
        "allowSign": _boolean_property(type_key, "allowSign"),
        "minimum": _number_property(type_key, "minimum"),
        "maximum": _number_property(type_key, "maximum"),
    }
    return properties


def _capture_screen_definition() -> NodeDefinitionV1:
    type_key = "automation.captureScreen"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="deviceRead",
        category="device",
        icon_key="node.imageRecognition",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("image", "output", "imageRef", type_key),
            _data_port("width", "output", "number", type_key),
            _data_port("height", "output", "number", type_key),
            _exec_port("next", "output", type_key),
        ],
        required_capabilities=["automation.captureScreen"],
    )


def _ocr_definition() -> NodeDefinitionV1:
    type_key = "vision.ocr"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="runtime",
        category="vision",
        icon_key="node.ocr",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("image", "input", "imageRef", type_key, required=True),
            _data_port("roi", "input", "rect", type_key),
            _collection_port("regions", "input", "rect", type_key),
            _data_port("confidenceThreshold", "input", "number", type_key),
            _data_port("result", "output", "ocrResult", type_key),
            _data_port("matched", "output", "bool", type_key),
            _data_port("bestText", "output", "string", type_key),
            _data_port("bestConfidence", "output", "number", type_key),
            _data_port("matchedRegionIndex", "output", "number", type_key),
            _data_port("bestRect", "output", "rect", type_key),
            _exec_port("next", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["confidenceThreshold"],
            "properties": {
                "confidenceThreshold": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "x-rinoLabelKey": (
                        f"node.{type_key}.property.confidenceThreshold.label"
                    ),
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.confidenceThreshold.description"
                    ),
                },
                "expected": {
                    "type": "array",
                    "minItems": 0,
                    "maxItems": 32,
                    "items": {"type": "string", "maxLength": 256},
                    "x-rinoLabelKey": f"node.{type_key}.property.expected.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.expected.description"
                    ),
                },
            },
        },
        property_defaults={"confidenceThreshold": 0.3, "expected": []},
        required_capabilities=["vision.ocr"],
    )


def _match_ports(
    type_key: str,
    *,
    with_template: bool,
    metric_name: str,
    metrics_name: str,
) -> list[dict[str, object]]:
    ports = [
        _exec_port("run", "input", type_key),
        _data_port("image", "input", "imageRef", type_key, required=True),
    ]
    if with_template:
        ports.extend(
            [
                _data_port("template", "input", "imageRef", type_key),
                _collection_port("templates", "input", "imageRef", type_key),
            ]
        )
    ports.extend(
        [
            _data_port("roi", "input", "rect", type_key),
            _collection_port("regions", "input", "rect", type_key),
            _data_port("matched", "output", "bool", type_key),
            _data_port("bestRect", "output", "rect", type_key),
            _data_port(metric_name, "output", "number", type_key),
            _data_port("matchedRegionIndex", "output", "number", type_key),
            _collection_port("rects", "output", "rect", type_key),
            _collection_port(metrics_name, "output", "number", type_key),
            _exec_port("next", "output", type_key),
        ]
    )
    if with_template:
        ports.extend(
            [
                _data_port("matchedTemplate", "output", "imageRef", type_key),
                _data_port(
                    "matchedTemplateIndex",
                    "output",
                    "number",
                    type_key,
                ),
            ]
        )
    return ports


def _choice_property(
    type_key: str,
    property_name: str,
    values: list[str],
) -> dict[str, object]:
    return {
        "type": "string",
        "enum": values,
        "x-rinoLabelKey": f"node.{type_key}.property.{property_name}.label",
        "x-rinoDescriptionKey": (
            f"node.{type_key}.property.{property_name}.description"
        ),
        "x-rinoOptionLabelKeys": {
            value: f"node.{type_key}.property.{property_name}.option.{value}"
            for value in values
        },
    }


def _number_property(
    type_key: str,
    property_name: str,
    *,
    minimum: int | float | None = None,
    maximum: int | float | None = None,
    integer: bool = False,
) -> dict[str, object]:
    return {
        "type": "integer" if integer else "number",
        **({"minimum": minimum} if minimum is not None else {}),
        **({"maximum": maximum} if maximum is not None else {}),
        "x-rinoLabelKey": f"node.{type_key}.property.{property_name}.label",
        "x-rinoDescriptionKey": (
            f"node.{type_key}.property.{property_name}.description"
        ),
    }


def _boolean_property(type_key: str, property_name: str) -> dict[str, object]:
    return {
        "type": "boolean",
        "x-rinoLabelKey": f"node.{type_key}.property.{property_name}.label",
        "x-rinoDescriptionKey": (
            f"node.{type_key}.property.{property_name}.description"
        ),
    }


def _template_match_definition() -> NodeDefinitionV1:
    type_key = "vision.templateMatch"
    required = ["threshold", "method", "greenMask"]
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="runtime",
        category="vision",
        icon_key="recognition.template",
        ports=[
            *_match_ports(
                type_key,
                with_template=True,
                metric_name="bestScore",
                metrics_name="scores",
            ),
            _data_port("threshold", "input", "number", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": required,
            "properties": {
                "threshold": _number_property(
                    type_key, "threshold", minimum=0, maximum=1
                ),
                "method": _choice_property(
                    type_key,
                    "method",
                    ["normalizedCoefficient", "coefficient", "rgbDifference"],
                ),
                "greenMask": _boolean_property(type_key, "greenMask"),
            },
        },
        property_defaults={
            "threshold": 0.7,
            "method": "normalizedCoefficient",
            "greenMask": False,
        },
        required_capabilities=[type_key],
    )


def _feature_match_definition() -> NodeDefinitionV1:
    type_key = "vision.featureMatch"
    required = ["detector", "minimumCount", "ratio", "greenMask"]
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="runtime",
        category="vision",
        icon_key="recognition.feature",
        ports=_match_ports(
            type_key,
            with_template=True,
            metric_name="bestCount",
            metrics_name="counts",
        ),
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": required,
            "properties": {
                "detector": _choice_property(
                    type_key, "detector", ["SIFT", "KAZE", "AKAZE", "BRISK", "ORB"]
                ),
                "minimumCount": _number_property(
                    type_key,
                    "minimumCount",
                    minimum=1,
                    maximum=1000,
                    integer=True,
                ),
                "ratio": _number_property(
                    type_key, "ratio", minimum=0.01, maximum=0.99
                ),
                "greenMask": _boolean_property(type_key, "greenMask"),
            },
        },
        property_defaults={
            "detector": "SIFT",
            "minimumCount": 4,
            "ratio": 0.6,
            "greenMask": False,
        },
        required_capabilities=[type_key],
    )


def _color_match_definition() -> NodeDefinitionV1:
    type_key = "vision.colorMatch"
    channel_properties = {
        name: _number_property(
            type_key,
            name,
            minimum=0,
            maximum=255,
            integer=True,
        )
        for name in ("lower1", "lower2", "lower3", "upper1", "upper2", "upper3")
    }
    required = [
        "method",
        *channel_properties,
        "minimumCount",
        "connected",
    ]
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="runtime",
        category="vision",
        icon_key="recognition.color",
        ports=_match_ports(
            type_key,
            with_template=False,
            metric_name="bestCount",
            metrics_name="counts",
        ),
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": required,
            "properties": {
                "method": _choice_property(type_key, "method", ["RGB", "HSV", "GRAY"]),
                **channel_properties,
                "minimumCount": _number_property(
                    type_key,
                    "minimumCount",
                    minimum=1,
                    maximum=1_000_000,
                    integer=True,
                ),
                "connected": _boolean_property(type_key, "connected"),
            },
        },
        property_defaults={
            "method": "RGB",
            "lower1": 0,
            "lower2": 0,
            "lower3": 0,
            "upper1": 255,
            "upper2": 255,
            "upper3": 255,
            "minimumCount": 1,
            "connected": False,
        },
        required_capabilities=[type_key],
    )


def _click_rect_center_definition() -> NodeDefinitionV1:
    type_key = "automation.clickRectCenter"
    offset_properties = {
        name: _number_property(
            type_key,
            name,
            minimum=-65_536,
            maximum=65_536,
            integer=True,
        )
        for name in ("offsetX", "offsetY", "offsetWidth", "offsetHeight")
    }
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="deviceWrite",
        category="device",
        icon_key="node.click",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("rect", "input", "rect", type_key, required=True),
            *[
                _data_port(name, "input", "number", type_key)
                for name in offset_properties
            ],
            _data_port("clicked", "output", "bool", type_key),
            _exec_port("next", "output", type_key),
            _exec_port("failed", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": list(offset_properties),
            "properties": offset_properties,
        },
        property_defaults={name: 0 for name in offset_properties},
        required_capabilities=["automation.clickRectCenter"],
    )


def _click_point_definition() -> NodeDefinitionV1:
    type_key = "automation.clickPoint"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="deviceWrite",
        category="device",
        icon_key="node.click",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("point", "input", "point", type_key),
            _data_port("image", "input", "imageRef", type_key),
            _collection_port("points", "input", "point", type_key),
            _data_port("rect", "input", "rect", type_key),
            _direct_coordinate_input_port("x", type_key),
            _direct_coordinate_input_port("y", type_key),
            _direct_coordinate_input_port("referenceWidth", type_key),
            _direct_coordinate_input_port("referenceHeight", type_key),
            _data_port("clicked", "output", "bool", type_key),
            _data_port("clickedCount", "output", "number", type_key),
            _data_port("selectedIndex", "output", "number", type_key),
            _exec_port("next", "output", type_key),
            _exec_port("failed", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["inputMode"],
            "properties": {
                "inputMode": _choice_property(
                    type_key,
                    "inputMode",
                    list(CLICK_POINT_MODES),
                ),
                "intervalMilliseconds": _number_property(
                    type_key,
                    "intervalMilliseconds",
                    minimum=0,
                    maximum=60_000,
                    integer=True,
                ),
            },
        },
        property_defaults={
            "inputMode": "coordinates",
            "intervalMilliseconds": 100,
        },
        required_capabilities=["automation.clickPoint"],
    )


def _touch_action_definition() -> NodeDefinitionV1:
    type_key = "automation.touchAction"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="deviceWrite",
        category="device",
        icon_key="node.touchAction",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("start", "input", "point", type_key, required=True),
            _data_port("end", "input", "point", type_key),
            _data_port("secondaryStart", "input", "point", type_key),
            _data_port("secondaryEnd", "input", "point", type_key),
            _data_port("completed", "output", "bool", type_key),
            _exec_port("next", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": [
                "actionType",
                "longPressDurationMilliseconds",
                "swipeDurationMilliseconds",
                "secondaryStartDelayMilliseconds",
            ],
            "properties": {
                "actionType": _choice_property(
                    type_key,
                    "actionType",
                    ["click", "longPress", "swipe", "multiSwipe"],
                ),
                "longPressDurationMilliseconds": _number_property(
                    type_key,
                    "longPressDurationMilliseconds",
                    minimum=1,
                    maximum=60_000,
                    integer=True,
                ),
                "swipeDurationMilliseconds": _number_property(
                    type_key,
                    "swipeDurationMilliseconds",
                    minimum=1,
                    maximum=60_000,
                    integer=True,
                ),
                "secondaryStartDelayMilliseconds": _number_property(
                    type_key,
                    "secondaryStartDelayMilliseconds",
                    minimum=0,
                    maximum=60_000,
                    integer=True,
                ),
            },
        },
        property_defaults={
            "actionType": "click",
            "longPressDurationMilliseconds": 1_000,
            "swipeDurationMilliseconds": 200,
            "secondaryStartDelayMilliseconds": 0,
        },
        required_capabilities=[type_key],
    )


def _launch_android_app_definition() -> NodeDefinitionV1:
    type_key = "automation.launchAndroidApp"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="deviceWrite",
        category="device",
        icon_key="node.launchAndroidApp",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("launched", "output", "bool", type_key),
            _exec_port("next", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["intent"],
            "properties": {
                "intent": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 255,
                    "pattern": ANDROID_INTENT_PATTERN,
                    "x-rinoLabelKey": f"node.{type_key}.property.intent.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.intent.description"
                    ),
                }
            },
        },
        property_defaults={"intent": "com.example.app"},
        required_capabilities=[type_key],
    )


def _press_android_key_definition() -> NodeDefinitionV1:
    type_key = "automation.pressAndroidKey"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="deviceWrite",
        category="device",
        icon_key="node.pressAndroidKey",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("pressed", "output", "bool", type_key),
            _exec_port("next", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["key"],
            "properties": {"key": _choice_property(type_key, "key", ["escape"])},
        },
        property_defaults={"key": AndroidKey.ESCAPE.value},
        required_capabilities=[type_key],
    )


def _swipe_definition() -> NodeDefinitionV1:
    type_key = "automation.swipe"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="deviceWrite",
        category="device",
        icon_key="node.swipe",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port("start", "input", "point", type_key, required=True),
            _data_port("end", "input", "point", type_key, required=True),
            _data_port("completed", "output", "bool", type_key),
            _exec_port("next", "output", type_key),
            _exec_port("failed", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["durationMilliseconds"],
            "properties": {
                "durationMilliseconds": _number_property(
                    type_key,
                    "durationMilliseconds",
                    minimum=1,
                    maximum=60_000,
                    integer=True,
                )
            },
        },
        property_defaults={"durationMilliseconds": 200},
        required_capabilities=[type_key],
    )


def _fake_ocr_definition() -> NodeDefinitionV1:
    type_key = "test.fake.ocr"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="runtime",
        category="vision",
        icon_key="node.ocr",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port(
                "fixtureText",
                "input",
                "string",
                type_key,
                required=True,
                accepts_literal=True,
            ),
            _data_port("matched", "output", "bool", type_key),
            _data_port("text", "output", "string", type_key),
            _exec_port("next", "output", type_key),
        ],
        property_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["matched"],
            "properties": {
                "matched": {
                    "type": "boolean",
                    "x-rinoLabelKey": f"node.{type_key}.property.matched.label",
                    "x-rinoDescriptionKey": (
                        f"node.{type_key}.property.matched.description"
                    ),
                }
            },
        },
        property_defaults={"matched": True},
    )


def _fake_action_definition() -> NodeDefinitionV1:
    type_key = "test.fake.action"
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="deviceWrite",
        category="device",
        icon_key="node.click",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port(
                "label",
                "input",
                "string",
                type_key,
                accepts_literal=True,
            ),
            _data_port("recorded", "output", "bool", type_key),
            _exec_port("next", "output", type_key),
        ],
    )


def _compare_and_branch_template() -> WorkflowTemplateV1:
    return WorkflowTemplateV1.model_validate(
        {
            "templateKey": "template.compareNumbersAndBranch",
            "titleKey": "template.compareNumbersAndBranch.title",
            "descriptionKey": "template.compareNumbersAndBranch.description",
            "iconKey": "category.logic",
            "nodes": [
                {
                    "placeholderId": "start",
                    "typeKey": "core.flow.start",
                    "offset": {"x": 0, "y": 0},
                },
                {
                    "placeholderId": "compare",
                    "typeKey": "core.logic.numberCompare",
                    "offset": {"x": 300, "y": 100},
                    "inputValues": {"left": 0, "right": 100},
                },
                {
                    "placeholderId": "branch",
                    "typeKey": "core.logic.branch",
                    "offset": {"x": 620, "y": 0},
                },
            ],
            "edges": [
                {
                    "edgeKind": "execution",
                    "sourcePlaceholderId": "start",
                    "sourcePortId": "next",
                    "targetPlaceholderId": "branch",
                    "targetPortId": "run",
                },
                {
                    "edgeKind": "data",
                    "sourcePlaceholderId": "compare",
                    "sourcePortId": "result",
                    "targetPlaceholderId": "branch",
                    "targetPortId": "condition",
                },
            ],
        }
    )


def _recognize_number_and_branch_template() -> WorkflowTemplateV1:
    return WorkflowTemplateV1.model_validate(
        {
            "templateKey": "template.recognizeNumberAndBranch",
            "titleKey": "template.recognizeNumberAndBranch.title",
            "descriptionKey": "template.recognizeNumberAndBranch.description",
            "iconKey": "node.ocr",
            "nodes": [
                {
                    "placeholderId": "capture",
                    "typeKey": "automation.captureScreen",
                    "offset": {"x": 280, "y": 120},
                },
                {
                    "placeholderId": "ocr",
                    "typeKey": "vision.ocr",
                    "offset": {"x": 560, "y": 120},
                },
                {
                    "placeholderId": "matchedBranch",
                    "typeKey": "core.logic.branch",
                    "offset": {"x": 860, "y": 120},
                },
                {
                    "placeholderId": "parse",
                    "typeKey": "text.parseNumber",
                    "offset": {"x": 1160, "y": 120},
                },
                {
                    "placeholderId": "compare",
                    "typeKey": "core.logic.numberCompare",
                    "offset": {"x": 1440, "y": 340},
                    "inputValues": {"right": 100},
                },
                {
                    "placeholderId": "resultBranch",
                    "typeKey": "core.logic.branch",
                    "offset": {"x": 1740, "y": 120},
                },
                {
                    "placeholderId": "noMatchLog",
                    "typeKey": "core.diagnostic.log",
                    "offset": {"x": 1160, "y": -140},
                    "inputValues": {"message": "No OCR match"},
                },
                {
                    "placeholderId": "invalidNumberLog",
                    "typeKey": "core.diagnostic.log",
                    "offset": {"x": 1440, "y": -140},
                    "inputValues": {"message": "Invalid number"},
                },
            ],
            "edges": [
                {
                    "edgeKind": "execution",
                    "sourcePlaceholderId": "capture",
                    "sourcePortId": "next",
                    "targetPlaceholderId": "ocr",
                    "targetPortId": "run",
                },
                {
                    "edgeKind": "execution",
                    "sourcePlaceholderId": "ocr",
                    "sourcePortId": "next",
                    "targetPlaceholderId": "matchedBranch",
                    "targetPortId": "run",
                },
                {
                    "edgeKind": "execution",
                    "sourcePlaceholderId": "matchedBranch",
                    "sourcePortId": "whenTrue",
                    "targetPlaceholderId": "parse",
                    "targetPortId": "run",
                },
                {
                    "edgeKind": "execution",
                    "sourcePlaceholderId": "matchedBranch",
                    "sourcePortId": "whenFalse",
                    "targetPlaceholderId": "noMatchLog",
                    "targetPortId": "run",
                },
                {
                    "edgeKind": "execution",
                    "sourcePlaceholderId": "parse",
                    "sourcePortId": "parsed",
                    "targetPlaceholderId": "resultBranch",
                    "targetPortId": "run",
                },
                {
                    "edgeKind": "execution",
                    "sourcePlaceholderId": "parse",
                    "sourcePortId": "invalid",
                    "targetPlaceholderId": "invalidNumberLog",
                    "targetPortId": "run",
                },
                {
                    "edgeKind": "data",
                    "sourcePlaceholderId": "capture",
                    "sourcePortId": "image",
                    "targetPlaceholderId": "ocr",
                    "targetPortId": "image",
                },
                {
                    "edgeKind": "data",
                    "sourcePlaceholderId": "ocr",
                    "sourcePortId": "matched",
                    "targetPlaceholderId": "matchedBranch",
                    "targetPortId": "condition",
                },
                {
                    "edgeKind": "data",
                    "sourcePlaceholderId": "ocr",
                    "sourcePortId": "bestText",
                    "targetPlaceholderId": "parse",
                    "targetPortId": "text",
                },
                {
                    "edgeKind": "data",
                    "sourcePlaceholderId": "parse",
                    "sourcePortId": "number",
                    "targetPlaceholderId": "compare",
                    "targetPortId": "left",
                },
                {
                    "edgeKind": "data",
                    "sourcePlaceholderId": "compare",
                    "sourcePortId": "result",
                    "targetPlaceholderId": "resultBranch",
                    "targetPortId": "condition",
                },
            ],
            "exposedPorts": [
                {
                    "proxyPortId": "run",
                    "placeholderId": "capture",
                    "portId": "run",
                    "labelKey": "template.recognizeNumberAndBranch.port.run",
                },
                {
                    "proxyPortId": "next",
                    "placeholderId": "resultBranch",
                    "portId": "whenTrue",
                    "labelKey": "template.recognizeNumberAndBranch.port.next",
                },
            ],
        }
    )


def _capture_and_click_point_template() -> WorkflowTemplateV1:
    return WorkflowTemplateV1.model_validate(
        {
            "templateKey": "template.captureAndClickPoint",
            "titleKey": "template.captureAndClickPoint.title",
            "descriptionKey": "template.captureAndClickPoint.description",
            "iconKey": "node.click",
            "nodes": [
                {
                    "placeholderId": "start",
                    "typeKey": "core.flow.start",
                    "offset": {"x": 0, "y": 0},
                },
                {
                    "placeholderId": "capture",
                    "typeKey": "automation.captureScreen",
                    "offset": {"x": 280, "y": 0},
                },
                {
                    "placeholderId": "point",
                    "typeKey": "core.geometry.point",
                    "offset": {"x": 280, "y": 220},
                },
                {
                    "placeholderId": "click",
                    "typeKey": "automation.clickPoint",
                    "offset": {"x": 620, "y": 0},
                },
            ],
            "edges": [
                {
                    "edgeKind": "execution",
                    "sourcePlaceholderId": "start",
                    "sourcePortId": "next",
                    "targetPlaceholderId": "capture",
                    "targetPortId": "run",
                },
                {
                    "edgeKind": "execution",
                    "sourcePlaceholderId": "capture",
                    "sourcePortId": "next",
                    "targetPlaceholderId": "click",
                    "targetPortId": "run",
                },
                {
                    "edgeKind": "data",
                    "sourcePlaceholderId": "capture",
                    "sourcePortId": "image",
                    "targetPlaceholderId": "point",
                    "targetPortId": "image",
                },
                {
                    "edgeKind": "data",
                    "sourcePlaceholderId": "point",
                    "sourcePortId": "point",
                    "targetPlaceholderId": "click",
                    "targetPortId": "point",
                },
            ],
        }
    )


def _recognition_group_template(
    *,
    recognition_kind: str,
) -> WorkflowTemplateV1:
    is_image = recognition_kind == "image"
    group_kind = "imageRecognition" if is_image else "textRecognition"
    template_key = (
        "template.imageRecognition" if is_image else "template.textRecognition"
    )
    title_key = f"workflowGroup.{group_kind}.title"
    description_key = f"workflowGroup.{group_kind}.description"

    nodes: list[dict[str, object]] = [
        {
            "placeholderId": "delay",
            "typeKey": "core.time.delay",
            "offset": {"x": 0, "y": 0},
            "inputValues": {"durationMilliseconds": 0},
        },
        {
            "placeholderId": "capture",
            "typeKey": "automation.captureScreen",
            "offset": {"x": 280, "y": 0},
        },
        {
            "placeholderId": "recognizer",
            "typeKey": "vision.templateMatch" if is_image else "vision.ocr",
            "offset": {"x": 560, "y": 0},
        },
        {
            "placeholderId": "roi",
            "typeKey": "core.geometry.rectangle",
            "offset": {"x": 560, "y": 240},
            "inputValues": {
                "x": 0,
                "y": 0,
                "width": 1,
                "height": 1,
                "referenceWidth": 1,
                "referenceHeight": 1,
            },
        },
        {
            "placeholderId": "matchBranch",
            "typeKey": "core.logic.branch",
            "offset": {"x": 840, "y": 0},
        },
    ]
    members: list[dict[str, str]] = [
        {"role": "delay", "placeholderId": "delay"},
        {"role": "capture", "placeholderId": "capture"},
        {"role": "recognizer", "placeholderId": "recognizer"},
        {"role": "roi", "placeholderId": "roi"},
        {"role": "matchBranch", "placeholderId": "matchBranch"},
    ]
    edges: list[dict[str, str]] = [
        {
            "edgeKind": "execution",
            "sourcePlaceholderId": "delay",
            "sourcePortId": "next",
            "targetPlaceholderId": "capture",
            "targetPortId": "run",
        },
        {
            "edgeKind": "execution",
            "sourcePlaceholderId": "capture",
            "sourcePortId": "next",
            "targetPlaceholderId": "recognizer",
            "targetPortId": "run",
        },
        {
            "edgeKind": "data",
            "sourcePlaceholderId": "capture",
            "sourcePortId": "image",
            "targetPlaceholderId": "recognizer",
            "targetPortId": "image",
        },
        {
            "edgeKind": "data",
            "sourcePlaceholderId": "capture",
            "sourcePortId": "image",
            "targetPlaceholderId": "roi",
            "targetPortId": "image",
        },
        {
            "edgeKind": "data",
            "sourcePlaceholderId": "roi",
            "sourcePortId": "rectangle",
            "targetPlaceholderId": "recognizer",
            "targetPortId": "roi",
        },
        {
            "edgeKind": "execution",
            "sourcePlaceholderId": "recognizer",
            "sourcePortId": "next",
            "targetPlaceholderId": "matchBranch",
            "targetPortId": "run",
        },
        {
            "edgeKind": "data",
            "sourcePlaceholderId": "recognizer",
            "sourcePortId": "matched",
            "targetPlaceholderId": "matchBranch",
            "targetPortId": "condition",
        },
    ]

    if is_image:
        nodes.extend(
            [
                {
                    "placeholderId": "templateAsset",
                    "typeKey": "core.image.projectAsset",
                    "offset": {"x": 280, "y": 240},
                },
                {
                    "placeholderId": "visibleOcr",
                    "typeKey": "vision.ocr",
                    "offset": {"x": 1120, "y": 0},
                },
            ]
        )
        members.extend(
            [
                {"role": "templateAsset", "placeholderId": "templateAsset"},
                {"role": "visibleOcr", "placeholderId": "visibleOcr"},
            ]
        )
        edges.extend(
            [
                {
                    "edgeKind": "data",
                    "sourcePlaceholderId": "templateAsset",
                    "sourcePortId": "image",
                    "targetPlaceholderId": "recognizer",
                    "targetPortId": "template",
                },
                {
                    "edgeKind": "execution",
                    "sourcePlaceholderId": "matchBranch",
                    "sourcePortId": "whenTrue",
                    "targetPlaceholderId": "visibleOcr",
                    "targetPortId": "run",
                },
                {
                    "edgeKind": "data",
                    "sourcePlaceholderId": "capture",
                    "sourcePortId": "image",
                    "targetPlaceholderId": "visibleOcr",
                    "targetPortId": "image",
                },
                {
                    "edgeKind": "data",
                    "sourcePlaceholderId": "recognizer",
                    "sourcePortId": "bestRect",
                    "targetPlaceholderId": "visibleOcr",
                    "targetPortId": "roi",
                },
            ]
        )

    result_placeholder = "visibleOcr" if is_image else "recognizer"
    next_placeholder = result_placeholder if is_image else "matchBranch"
    next_port = "next" if is_image else "whenTrue"
    nodes.append(
        {
            "placeholderId": "click",
            "typeKey": "core.flow.sequence",
            "offset": {"x": 1400 if is_image else 1120, "y": 0},
        }
    )
    members.append({"role": "click", "placeholderId": "click"})
    edges.append(
        {
            "edgeKind": "execution",
            "sourcePlaceholderId": next_placeholder,
            "sourcePortId": next_port,
            "targetPlaceholderId": "click",
            "targetPortId": "run",
        }
    )
    if not is_image:
        nodes.append(
            {
                "placeholderId": "clickPoint",
                "typeKey": "core.geometry.point",
                "offset": {"x": 1120, "y": 240},
                "inputValues": {
                    "x": 0,
                    "y": 0,
                    "referenceWidth": 1,
                    "referenceHeight": 1,
                },
            }
        )
        members.append({"role": "clickPoint", "placeholderId": "clickPoint"})
        edges.append(
            {
                "edgeKind": "data",
                "sourcePlaceholderId": "capture",
                "sourcePortId": "image",
                "targetPlaceholderId": "clickPoint",
                "targetPortId": "image",
            }
        )
    next_placeholder = "click"
    next_port = "steps"

    exposed_ports = [
        {
            "proxyPortId": "run",
            "placeholderId": "delay",
            "portId": "run",
            "labelKey": f"workflowGroup.{group_kind}.port.run",
        },
        {
            "proxyPortId": "matched",
            "placeholderId": "recognizer",
            "portId": "matched",
            "labelKey": f"workflowGroup.{group_kind}.port.matched",
        },
        {
            "proxyPortId": "result",
            "placeholderId": result_placeholder,
            "portId": "result",
            "labelKey": f"workflowGroup.{group_kind}.port.result",
        },
        {
            "proxyPortId": "bestText",
            "placeholderId": result_placeholder,
            "portId": "bestText",
            "labelKey": f"workflowGroup.{group_kind}.port.bestText",
        },
        {
            "proxyPortId": "bestRect",
            "placeholderId": "recognizer",
            "portId": "bestRect",
            "labelKey": f"workflowGroup.{group_kind}.port.bestRect",
        },
        {
            "proxyPortId": "image",
            "placeholderId": "capture",
            "portId": "image",
            "labelKey": f"workflowGroup.{group_kind}.port.image",
        },
        {
            "proxyPortId": "noMatch",
            "placeholderId": "matchBranch",
            "portId": "whenFalse",
            "labelKey": f"workflowGroup.{group_kind}.port.noMatch",
        },
        {
            "proxyPortId": "next",
            "placeholderId": next_placeholder,
            "portId": next_port,
            "labelKey": f"workflowGroup.{group_kind}.port.next",
        },
    ]
    exposed_ports.insert(
        1,
        {
            "proxyPortId": "regions",
            "placeholderId": "recognizer",
            "portId": "regions",
            "labelKey": f"workflowGroup.{group_kind}.port.regions",
        },
    )
    if is_image:
        exposed_ports.insert(
            1,
            {
                "proxyPortId": "templates",
                "placeholderId": "recognizer",
                "portId": "templates",
                "labelKey": f"workflowGroup.{group_kind}.port.templates",
            },
        )
    exposed_ports = [
        port
        for port in exposed_ports
        if port["proxyPortId"] not in {"result", "bestText", "bestRect"}
    ]
    matched_port_index = next(
        index
        for index, port in enumerate(exposed_ports)
        if port["proxyPortId"] == "matched"
    )
    exposed_ports.insert(
        matched_port_index + 1,
        {
            "proxyPortId": "matchValue",
            "placeholderId": "recognizer",
            "portId": "bestScore" if is_image else "bestConfidence",
            "labelKey": f"workflowGroup.{group_kind}.port.matchValue",
        },
    )
    return WorkflowTemplateV1.model_validate(
        {
            "templateKey": template_key,
            "titleKey": title_key,
            "descriptionKey": description_key,
            "iconKey": "node.imageRecognition" if is_image else "node.ocr",
            "nodes": nodes,
            "edges": edges,
            "workflowGroup": {
                "kind": group_kind,
                "members": members,
                "exposedPorts": exposed_ports,
            },
        }
    )


def _image_recognition_group_template() -> WorkflowTemplateV1:
    return _recognition_group_template(recognition_kind="image")


def _text_recognition_group_template() -> WorkflowTemplateV1:
    return _recognition_group_template(recognition_kind="text")
