from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any
from visual_region_detector import (
    DEFAULT_MODEL as DEFAULT_POSE_MODEL,
    DEFAULT_ORIENTATION_MODEL,
    detect_image,
    draw_detection_result,
    load_model,
    load_orientation_classifier,
    select_device as select_inference_device,
)


DEFAULT_INPUT_DIR = Path(r"F:\pictures\test")
DEFAULT_OUTPUT_DIR = Path(r"F:\pictures\test_result")
def iter_images(input_dir: Path) -> list[Path]:
    return [
        path
        for path in input_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in (".jpg", ".jpeg", ".png")
    ]


def output_path_for(input_path: Path, input_dir: Path, output_dir: Path) -> Path:
    return output_dir / input_path.relative_to(input_dir)


def process_images(
    input_dir: Path,
    output_dir: Path,
    model_path: Path,
    orientation_model_path: Path | None,
    device_name: str,
    score_threshold: float,
) -> int:
    test_started_at = time.perf_counter()
    image_paths = iter_images(input_dir)
    if not image_paths:
        print(f"No supported images found in {input_dir}")
        return 1
    device = select_inference_device(device_name)
    print(f"Loading YOLO26 pose model from {model_path} on {device}...")
    model = load_model(model_path)
    orientation_classifier = load_orientation_classifier(orientation_model_path, device)
    print(f"Orientation model enabled: {orientation_classifier is not None}")
    output_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    for index, image_path in enumerate(image_paths, start=1):
        print(f"[{index}/{len(image_paths)}] {image_path}")
        image_started_at = time.perf_counter()
        try:
            result = detect_image(
                model,
                image_path,
                device,
                score_threshold,
                orientation_classifier,
            )
            rendered = draw_detection_result(image_path, result)
            rendered_path = output_path_for(image_path, input_dir, output_dir)
            rendered_path.parent.mkdir(parents=True, exist_ok=True)
            if rendered_path.suffix.lower() in {".jpg", ".jpeg"}:
                rendered.save(rendered_path, quality=95)
            else:
                rendered.save(rendered_path)
            result["elapsed_seconds"] = round(time.perf_counter() - image_started_at, 3)
            results.append(result)
            print(f"  Elapsed: {result['elapsed_seconds']:.3f}s")
        except Exception as error:
            elapsed_seconds = round(time.perf_counter() - image_started_at, 3)
            results.append(
                {
                    "image": str(image_path),
                    "error": str(error),
                    "elapsed_seconds": elapsed_seconds,
                }
            )
            print(f"  ERROR: {error}")
            print(f"  Elapsed: {elapsed_seconds:.3f}s")

    summary_path = output_dir / "results.json"
    summary_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {len(results)} results to {output_dir}")
    print(f"JSON summary: {summary_path}")
    print(f"Total elapsed: {time.perf_counter() - test_started_at:.3f}s")
    return 0 if all("error" not in result for result in results) else 2


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run simple YOLO26 pose detection over a directory of test images"
    )
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--model", type=Path, default=Path(DEFAULT_POSE_MODEL))
    parser.add_argument("--orientation-model", type=Path, default=DEFAULT_ORIENTATION_MODEL)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="cuda")
    parser.add_argument("--score-threshold", type=float, default=0.45)
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    return process_images(
        arguments.input_dir,
        arguments.output_dir,
        arguments.model,
        arguments.orientation_model,
        arguments.device,
        arguments.score_threshold,
    )


if __name__ == "__main__":
    raise SystemExit(main())
