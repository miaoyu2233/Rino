"""Run a sanitized fixed-model OCR acceptance probe without a real device."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from maa.pipeline import JOCR
from maa.resource import Resource
from maa.tasker import Tasker
from rino_runtime.backends.maa.binding import OfficialMaaOcrSession
from rino_runtime.backends.maa.errors import MaaBackendError

from probe import SafeProbeController, configure_runtime

PROJECT_ROOT = Path(__file__).resolve().parents[3]

GLYPHS: dict[str, tuple[str, ...]] = {
    "1": ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    "2": ("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
    "3": ("11110", "00001", "00001", "01110", "00001", "00001", "11110"),
    "4": ("00010", "00110", "01010", "10010", "11111", "00010", "00010"),
    "5": ("11111", "10000", "10000", "11110", "00001", "00001", "11110"),
    ".": ("00000", "00000", "00000", "00000", "00000", "00110", "00110"),
}


def parse_arguments(arguments: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-directory", type=Path, required=True)
    parser.add_argument(
        "--user-data",
        type=Path,
        default=(
            PROJECT_ROOT / ".ai-local" / "spikes" / "maa-python" / "ocr-user-data"
        ),
    )
    return parser.parse_args(arguments)


def create_numeric_fixture(text: str = "123.45") -> np.ndarray:
    scale = 8
    glyph_width = 5 * scale
    glyph_height = 7 * scale
    spacing = 2 * scale
    margin = 20
    width = margin * 2 + len(text) * glyph_width + (len(text) - 1) * spacing
    height = margin * 2 + glyph_height
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    cursor_x = margin
    for character in text:
        for row_index, row in enumerate(GLYPHS[character]):
            for column_index, filled in enumerate(row):
                if filled == "1":
                    y = margin + row_index * scale
                    x = cursor_x + column_index * scale
                    image[y : y + scale, x : x + scale] = 0
        cursor_x += glyph_width + spacing
    return image


def run_probe(model_directory: Path, user_data: Path) -> dict[str, object]:
    configure_runtime(user_data)
    image = create_numeric_fixture()
    controller = SafeProbeController(image)
    connection = controller.post_connection().wait()
    resource = Resource()
    cpu_selected = resource.use_cpu()
    model_job = resource.post_ocr_model(model_directory.resolve()).wait()
    tasker = Tasker()
    bound = tasker.bind(resource, controller)
    session = OfficialMaaOcrSession(tasker, JOCR)
    try:
        snapshot = session.recognize(
            image,
            roi=(0, 0, 0, 0),
            confidence_threshold=0.3,
        )
    except MaaBackendError as error:
        return {
            "passed": False,
            "adapter_error_code": error.code.value,
            "adapter_error_reason": error.technical_detail,
            "adapter_error_cause_type": (
                type(error.__cause__).__name__ if error.__cause__ is not None else None
            ),
            "adapter_error_missing_attribute": getattr(
                error.__cause__,
                "name",
                None,
            ),
            "direct_result_structure": _direct_result_structure(tasker, image),
            "recognized_text_redacted": True,
        }
    passed = all(
        (
            connection.succeeded,
            cpu_selected,
            model_job.succeeded,
            resource.loaded,
            bound,
            snapshot.operation_id > 0,
            snapshot.matched,
            bool(snapshot.candidates),
        )
    )
    return {
        "passed": passed,
        "connected": connection.succeeded,
        "cpu_inference": cpu_selected,
        "model_loaded": model_job.succeeded and resource.loaded,
        "tasker_bound": bound,
        "matched": snapshot.matched,
        "candidate_count": len(snapshot.candidates),
        "operation_id_present": snapshot.operation_id > 0,
        "recognized_text_redacted": True,
    }


def _direct_result_structure(
    tasker: Tasker,
    image: np.ndarray,
) -> dict[str, object]:
    job = tasker.post_recognition("OCR", JOCR(), image).wait()
    task = job.get()
    nodes = [] if task is None else task.nodes
    recognitions = [node.recognition for node in nodes if node.recognition is not None]
    if len(recognitions) != 1:
        return {
            "job_succeeded": job.succeeded,
            "node_count": len(nodes),
            "recognition_count": len(recognitions),
        }
    recognition = recognitions[0]
    candidates = recognition.filtered_results
    return {
        "job_succeeded": job.succeeded,
        "node_count": len(nodes),
        "recognition_count": 1,
        "operation_id": recognition.reco_id,
        "algorithm": str(recognition.algorithm),
        "algorithm_value": getattr(
            recognition.algorithm,
            "value",
            recognition.algorithm,
        ),
        "algorithm_type": type(recognition.algorithm).__name__,
        "hit": recognition.hit,
        "image_shape": list(image.shape),
        "candidate_count": len(candidates),
        "candidates": [
            {
                "type": type(candidate).__name__,
                "score": candidate.score,
                "score_type": type(candidate.score).__name__,
                "box": list(candidate.box),
                "box_value_types": [
                    type(coordinate).__name__ for coordinate in candidate.box
                ],
                "text_type": type(candidate.text).__name__,
                "text_length": len(candidate.text),
            }
            for candidate in candidates
        ],
    }


def main(arguments: Sequence[str] | None = None) -> int:
    options = parse_arguments(arguments)
    try:
        report = run_probe(options.model_directory, options.user_data)
    except MaaBackendError as error:
        report = {
            "passed": False,
            "error_code": error.code.value,
            "retryable": error.retryable,
        }
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        report = {"passed": False, "error_type": type(error).__name__}
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report.get("passed") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
