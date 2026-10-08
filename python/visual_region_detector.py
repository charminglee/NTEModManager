from __future__ import annotations

import argparse
import base64
import configparser
import io
import json
import logging
import os
import platform
import random
import sys
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import torch
from PIL import Image, ImageDraw
from ultralytics import YOLO
from torchvision import models, transforms


LOGGER = logging.getLogger("visual_region_detector")


def configure_logging() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                stream.reconfigure(encoding="utf-8", errors="backslashreplace")
            except (OSError, ValueError):
                pass
    logging.basicConfig(
        level=logging.INFO,
        format="%(name)s: %(message)s",
        stream=sys.stderr,
        force=True,
    )


DEFAULT_MODEL = "yolo26x-pose.pt"
DEFAULT_ORIENTATION_MODEL = Path("training/orientation/checkpoints/weighted_unfrozen/best.pt")
DEFAULT_WINDOW_SIZE = (1315, 1000)
MINIMUM_CUDA_FREE_BYTES = 5 * 1024**3
CHEST_TOP_FRAME_RATIO = 0.12
ORIENTATION_CONFIDENCE_THRESHOLD = 0.50
ORIENTATION_CLASSES = {"front", "back", "uncertain"}
IMAGE_MEAN = (0.485, 0.456, 0.406)
IMAGE_STD = (0.229, 0.224, 0.225)
SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png"}
KEYPOINT_CONFIDENCE = 0.30
KEYPOINT_NAMES = (
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
)
REGION_COLORS = {
    "chest": (255, 80, 80),
    "hip": (80, 190, 255),
}
FRAME_COLOR = (255, 220, 70)
ORIENTATION_LABEL_COLOR = {
    "front": (90, 220, 120),
    "back": (90, 180, 255),
    "uncertain": (255, 190, 80),
}
SKELETON = (
    (5, 6),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    (5, 11),
    (6, 12),
    (11, 12),
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
)


def select_device(requested: str) -> str:
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested, but this Python environment has no CUDA device")
    if requested == "cpu":
        return "cpu"
    if not torch.cuda.is_available():
        LOGGER.info("CUDA 不可用，使用 CPU 计算")
        return "cpu"

    try:
        free_bytes, total_bytes = torch.cuda.mem_get_info(0)
    except RuntimeError as error:
        if requested == "cuda":
            raise RuntimeError("Unable to query available CUDA video memory") from error
        LOGGER.warning("无法查询 CUDA 空闲显存，使用 CPU 计算：%s", error)
        return "cpu"

    free_gib = free_bytes / (1024**3)
    total_gib = total_bytes / (1024**3)
    if free_bytes < MINIMUM_CUDA_FREE_BYTES:
        LOGGER.warning(
            "检测到 CUDA 空闲显存较低（%.2f / %.2f GB），使用 CPU 计算",
            free_gib,
            total_gib,
        )
        return "cpu"

    LOGGER.info(
        "CUDA 空闲显存 %.2f / %.2f GB，使用 CUDA 计算",
        free_gib,
        total_gib,
    )
    return "0"


def log_startup_information(arguments: argparse.Namespace, resolved_model_path: Path) -> None:
    LOGGER.info("========== 视觉识别服务启动 ==========")
    LOGGER.info(
        "环境：Python=%s，implementation=%s，executable=%s，platform=%s，machine=%s，cwd=%s",
        platform.python_version(),
        platform.python_implementation(),
        sys.executable,
        sys.platform,
        platform.machine(),
        Path.cwd(),
    )
    cuda_available = torch.cuda.is_available()
    device_count = torch.cuda.device_count() if cuda_available else 0
    LOGGER.info(
        "环境：torch=%s，torch_cuda=%s，cuda_available=%s，cuda_device_count=%s",
        torch.__version__,
        torch.version.cuda,
        cuda_available,
        device_count,
    )
    if cuda_available:
        for device_index in range(device_count):
            try:
                free_bytes, total_bytes = torch.cuda.mem_get_info(device_index)
                LOGGER.info(
                    "环境：CUDA[%s]=%s，capability=%s，显存空闲=%.2f / %.2f GB",
                    device_index,
                    torch.cuda.get_device_name(device_index),
                    torch.cuda.get_device_capability(device_index),
                    free_bytes / (1024**3),
                    total_bytes / (1024**3),
                )
            except RuntimeError as error:
                LOGGER.warning("环境：读取 CUDA[%s] 信息失败：%s", device_index, error)
    LOGGER.info(
        "配置：server=%s，http=%s，requested_device=%s，score_threshold=%.3f，orientation_confidence_threshold=%.3f",
        arguments.server,
        arguments.http,
        arguments.device,
        arguments.score_threshold,
        arguments.orientation_confidence_threshold,
    )
    LOGGER.info(
        "配置：pose_model=%s，resolved_pose_model=%s，cache_dir=%s",
        arguments.model,
        resolved_model_path,
        arguments.cache_dir or "<none>",
    )
    LOGGER.info(
        "配置：orientation_model=%s，exists=%s",
        arguments.orientation_model,
        arguments.orientation_model.is_file(),
    )


def resolve_model_path(model_path: Path, cache_dir: Path | None = None) -> Path:
    if model_path.is_absolute() or model_path.exists() or cache_dir is None:
        return model_path
    return cache_dir / model_path.name


def load_model(model_path: Path, cache_dir: Path | None = None) -> YOLO:
    resolved_model_path = resolve_model_path(model_path, cache_dir)
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
    return YOLO(str(resolved_model_path))


class OrientationClassifier:
    def __init__(
        self,
        checkpoint_path: Path,
        device: torch.device,
        confidence_threshold: float = ORIENTATION_CONFIDENCE_THRESHOLD,
    ) -> None:
        checkpoint = torch.load(checkpoint_path, map_location=device)
        class_names = tuple(checkpoint["class_names"])
        if set(class_names) != ORIENTATION_CLASSES or len(class_names) != len(ORIENTATION_CLASSES):
            raise ValueError(
                "Orientation checkpoint must contain exactly back, front and uncertain classes"
            )
        image_size = int(checkpoint["image_size"])
        model = models.convnext_tiny(weights=None)
        classifier = model.classifier[2]
        model.classifier[2] = torch.nn.Linear(classifier.in_features, len(class_names))
        model.load_state_dict(checkpoint["model_state_dict"])
        self.model = model.to(device).eval()
        self.class_names = class_names
        self.device = device
        self.confidence_threshold = confidence_threshold
        resize_size = int(image_size * 1.14 + 0.9999)
        self.transform = transforms.Compose(
            [
                transforms.Resize(resize_size),
                transforms.CenterCrop(image_size),
                transforms.ToTensor(),
                transforms.Normalize(IMAGE_MEAN, IMAGE_STD),
            ]
        )

    def predict(self, image: Image.Image) -> tuple[str, float]:
        tensor = self.transform(image.convert("RGB")).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            probabilities = torch.softmax(self.model(tensor), dim=1)[0]
        confidence, index = probabilities.max(dim=0)
        orientation = self.class_names[int(index.item())]
        confidence_value = float(confidence.item())
        if orientation in {"front", "back"} and confidence_value < self.confidence_threshold:
            orientation = "uncertain"
        return orientation, confidence_value


def orientation_device(device: str) -> torch.device:
    return torch.device("cuda:0" if device != "cpu" and torch.cuda.is_available() else "cpu")


def load_orientation_classifier(model_path: Path | None, device: str) -> OrientationClassifier | None:
    if model_path is None or not model_path.is_file():
        return None
    return OrientationClassifier(model_path, orientation_device(device))


def iter_images(input_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in input_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
    )


def draw_detection_overlay(
    result: dict[str, Any],
    image_size: tuple[int, int],
    viewport_size: tuple[int, int] = DEFAULT_WINDOW_SIZE,
) -> Image.Image:
    analyze_result(result, image_size, viewport_size)
    overlay = Image.new("RGBA", image_size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    line_width = max(3, min(image_size) // 180)

    background_crop = result["background_crop"]
    if background_crop["width"] > 0 and background_crop["height"] > 0:
        frame_rectangle = (
            background_crop["x"],
            background_crop["y"],
            background_crop["x"] + background_crop["width"] - 1,
            background_crop["y"] + background_crop["height"] - 1,
        )
        draw.rectangle(
            frame_rectangle,
            outline=FRAME_COLOR,
            width=max(3, line_width * 2),
        )
    if not result.get("detected", False):
        draw.rectangle(
            (0, 0, image_size[0] - 1, image_size[1] - 1),
            outline=(255, 180, 50, 255),
            width=line_width,
        )

    for person in result.get("persons", []):
        person_box = person["box"]
        person_rectangle = (
            person_box["x"],
            person_box["y"],
            person_box["x"] + person_box["width"] - 1,
            person_box["y"] + person_box["height"] - 1,
        )
        draw.rectangle(
            person_rectangle,
            outline=(255, 255, 255, 220),
            width=max(1, line_width // 2),
        )

        for region_name, region_box in person.get("regions", {}).items():
            region_rectangle = (
                region_box["x"],
                region_box["y"],
                region_box["x"] + region_box["width"] - 1,
                region_box["y"] + region_box["height"] - 1,
            )
            draw.rectangle(
                region_rectangle,
                outline=REGION_COLORS.get(region_name, (255, 255, 255)),
                width=max(2, line_width),
            )

        keypoints = person.get("keypoints", {})
        for first_index, second_index in SKELETON:
            first = keypoints.get(KEYPOINT_NAMES[first_index])
            second = keypoints.get(KEYPOINT_NAMES[second_index])
            if first and second and first["confidence"] >= KEYPOINT_CONFIDENCE and second["confidence"] >= KEYPOINT_CONFIDENCE:
                draw.line(
                    (first["x"], first["y"], second["x"], second["y"]),
                    fill=(255, 255, 255, 220),
                    width=max(1, line_width // 2),
                )
        for point in keypoints.values():
            if point["confidence"] >= KEYPOINT_CONFIDENCE:
                radius = max(2, line_width)
                draw.ellipse(
                    (point["x"] - radius, point["y"] - radius, point["x"] + radius, point["y"] + radius),
                    fill=(255, 255, 255, 230),
                )

        orientation = person.get("orientation")
        if orientation:
            label = str(orientation)
            label_color = ORIENTATION_LABEL_COLOR.get(label, (255, 255, 255))
            label_padding = max(3, line_width // 2)
            label_box = draw.textbbox((0, 0), label)
            label_width = label_box[2] - label_box[0] + label_padding * 2
            label_height = label_box[3] - label_box[1] + label_padding * 2
            label_x = max(0, person_box["x"])
            label_y = person_box["y"] - label_height
            if label_y < 0:
                label_y = person_box["y"]
            label_x = min(label_x, max(0, image_size[0] - label_width))
            draw.rectangle(
                (label_x, label_y, label_x + label_width, label_y + label_height),
                fill=(0, 0, 0, 190),
            )
            draw.text(
                (label_x + label_padding, label_y + label_padding - label_box[1]),
                label,
                fill=label_color,
            )

    return overlay


def draw_detection_result(image_path: Path, result: dict[str, Any]) -> Image.Image:
    with Image.open(image_path) as source:
        image = source.convert("RGB").copy()
    overlay = draw_detection_overlay(result, image.size)
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


def encode_detection_overlay(
    result: dict[str, Any],
    image_size: tuple[int, int],
    viewport_size: tuple[int, int] = DEFAULT_WINDOW_SIZE,
) -> str:
    overlay = draw_detection_overlay(result, image_size, viewport_size)
    encoded = io.BytesIO()
    overlay.save(encoded, format="PNG", optimize=True)
    return base64.b64encode(encoded.getvalue()).decode("ascii")


def visible_keypoint(keypoints: dict[str, dict[str, Any]], name: str) -> dict[str, Any] | None:
    point = keypoints.get(name)
    if point is None or point.get("confidence", 0.0) < KEYPOINT_CONFIDENCE:
        return None
    return point


def make_region_box(
    left: float,
    top: float,
    right: float,
    bottom: float,
    image_size: tuple[int, int],
) -> dict[str, int] | None:
    image_width, image_height = image_size
    if image_width <= 0 or image_height <= 0:
        return None

    left_pixel = max(0, min(image_width - 1, int(round(left))))
    top_pixel = max(0, min(image_height - 1, int(round(top))))
    right_pixel = max(left_pixel + 1, min(image_width, int(round(right))))
    bottom_pixel = max(top_pixel + 1, min(image_height, int(round(bottom))))
    return {
        "x": left_pixel,
        "y": top_pixel,
        "width": right_pixel - left_pixel,
        "height": bottom_pixel - top_pixel,
    }


def complete_shoulder_keypoints(
    keypoints: dict[str, dict[str, Any]],
    person_box: dict[str, int] | None,
    image_size: tuple[int, int],
) -> dict[str, dict[str, Any]]:
    completed = dict(keypoints)
    left_shoulder = visible_keypoint(completed, "left_shoulder")
    right_shoulder = visible_keypoint(completed, "right_shoulder")
    if (left_shoulder is None) == (right_shoulder is None):
        return completed

    image_width, image_height = image_size
    body_left = 0
    body_top = 0
    body_right = image_width
    body_bottom = image_height
    if person_box is not None:
        body_left = max(0, person_box.get("x", 0))
        body_top = max(0, person_box.get("y", 0))
        body_right = min(image_width, body_left + max(1, person_box.get("width", image_width)))
        body_bottom = min(image_height, body_top + max(1, person_box.get("height", image_height)))
    if body_right <= body_left or body_bottom <= body_top:
        return completed

    present_name = "left_shoulder" if left_shoulder is not None else "right_shoulder"
    missing_name = "right_shoulder" if left_shoulder is not None else "left_shoulder"
    present = left_shoulder if left_shoulder is not None else right_shoulder
    assert present is not None
    body_center_x = (body_left + body_right) / 2.0
    virtual_x = 2.0 * body_center_x - present["x"]
    virtual_x = max(float(body_left), min(virtual_x, float(body_right - 1)))
    if abs(virtual_x - present["x"]) < 1.0:
        virtual_x = float(body_right - 1 if present_name == "left_shoulder" else body_left)

    completed[missing_name] = {
        "x": virtual_x,
        "y": max(float(body_top), min(float(present["y"]), float(body_bottom - 1))),
        "confidence": float(present.get("confidence", KEYPOINT_CONFIDENCE)),
        "virtual": True,
    }
    return completed


def body_regions_for_keypoints(
    keypoints: dict[str, dict[str, Any]],
    image_size: tuple[int, int],
    person_box: dict[str, int] | None = None,
) -> dict[str, dict[str, int]]:
    keypoints = complete_shoulder_keypoints(keypoints, person_box, image_size)
    left_shoulder = visible_keypoint(keypoints, "left_shoulder")
    right_shoulder = visible_keypoint(keypoints, "right_shoulder")
    left_hip = visible_keypoint(keypoints, "left_hip")
    right_hip = visible_keypoint(keypoints, "right_hip")
    regions: dict[str, dict[str, int]] = {}
    torso_height: float | None = None

    if left_shoulder is not None and right_shoulder is not None:
        shoulder_center_y = (left_shoulder["y"] + right_shoulder["y"]) / 2.0
        shoulder_width = max(abs(left_shoulder["x"] - right_shoulder["x"]), 1.0)
        torso_height = shoulder_width
        if left_hip is not None and right_hip is not None:
            hip_center_y = (left_hip["y"] + right_hip["y"]) / 2.0
            torso_height = max(abs(hip_center_y - shoulder_center_y), shoulder_width)
            chest_bottom_y = shoulder_center_y + (hip_center_y - shoulder_center_y) * 0.5
        else:
            chest_bottom_y = shoulder_center_y + shoulder_width * 0.5

        chest_box = make_region_box(
            min(left_shoulder["x"], right_shoulder["x"]) - shoulder_width * 0.08,
            shoulder_center_y,
            max(left_shoulder["x"], right_shoulder["x"]) + shoulder_width * 0.08,
            chest_bottom_y,
            image_size,
        )
        if chest_box is not None:
            regions["chest"] = chest_box

    if left_hip is not None and right_hip is not None:
        hip_center_x = (left_hip["x"] + right_hip["x"]) / 2.0
        hip_center_y = (left_hip["y"] + right_hip["y"]) / 2.0
        hip_width = max(abs(left_hip["x"] - right_hip["x"]) * 1.6, 1.0)
        hip_height = max(hip_width * 0.8, (torso_height or hip_width) * 0.28)
        hip_box = make_region_box(
            hip_center_x - hip_width / 2.0,
            hip_center_y - hip_height * 0.35,
            hip_center_x + hip_width / 2.0,
            hip_center_y + hip_height * 0.65,
            image_size,
        )
        if hip_box is not None:
            regions["hip"] = hip_box

    return regions


def position_crop_axis(
    target_start: float,
    target_end: float,
    source_length: int,
    crop_length: int,
    preferred_start: float | None = None,
) -> int:
    maximum_start = max(0, source_length - crop_length)
    desired_start = (
        preferred_start
        if preferred_start is not None
        else (target_start + target_end) / 2.0 - crop_length / 2.0
    )
    if target_end - target_start <= crop_length:
        minimum_start = max(0.0, target_end - crop_length)
        maximum_target_start = min(float(target_start), float(maximum_start))
        if minimum_start <= maximum_target_start:
            desired_start = max(minimum_start, min(desired_start, maximum_target_start))
    return int(round(max(0.0, min(desired_start, float(maximum_start)))))


def bounds_for_region_boxes(region_boxes: list[dict[str, int]]) -> tuple[float, float, float, float] | None:
    if not region_boxes:
        return None
    return (
        min(region["x"] for region in region_boxes),
        min(region["y"] for region in region_boxes),
        max(region["x"] + region["width"] for region in region_boxes),
        max(region["y"] + region["height"] for region in region_boxes),
    )


def orientation_priority_bounds(result: dict[str, Any]) -> tuple[float, float, float, float] | None:
    priority_boxes: list[dict[str, int]] = []
    for person in result.get("persons", []):
        regions = person.get("regions", {})
        orientation = person.get("orientation", "uncertain")
        preferred_name = "hip" if orientation == "back" else "chest"
        fallback_name = "chest" if preferred_name == "hip" else "hip"
        preferred_region = regions.get(preferred_name) or regions.get(fallback_name)
        if preferred_region is not None:
            priority_boxes.append(preferred_region)
    return bounds_for_region_boxes(priority_boxes)


def back_hip_bounds(result: dict[str, Any]) -> tuple[float, float, float, float] | None:
    return bounds_for_region_boxes(
        [
            person["regions"]["hip"]
            for person in result.get("persons", [])
            if person.get("orientation") == "back" and "hip" in person.get("regions", {})
        ]
    )


def clamp_person_box(
    person_box: dict[str, int],
    image_size: tuple[int, int],
) -> tuple[int, int, int, int] | None:
    image_width, image_height = image_size
    left = max(0, min(image_width, person_box.get("x", 0)))
    top = max(0, min(image_height, person_box.get("y", 0)))
    right = max(left, min(image_width, left + max(0, person_box.get("width", 0))))
    bottom = max(top, min(image_height, top + max(0, person_box.get("height", 0))))
    return (left, top, right, bottom) if right > left and bottom > top else None


def classify_person_orientations(
    result: dict[str, Any],
    image: Image.Image,
    orientation_classifier: OrientationClassifier | None,
) -> None:
    if orientation_classifier is None:
        return
    for person in result.get("persons", []):
        crop_box = clamp_person_box(person.get("box", {}), image.size)
        if crop_box is None:
            person["orientation"] = "uncertain"
            person["orientation_confidence"] = 0.0
            continue
        orientation, confidence = orientation_classifier.predict(image.crop(crop_box))
        person["orientation"] = orientation
        person["orientation_confidence"] = confidence


def background_crop_for_result(
    result: dict[str, Any],
    image_size: tuple[int, int],
    viewport_size: tuple[int, int] = DEFAULT_WINDOW_SIZE,
) -> dict[str, int]:
    image_width, image_height = image_size
    viewport_width, viewport_height = viewport_size
    if image_width <= 0 or image_height <= 0 or viewport_width <= 0 or viewport_height <= 0:
        return {"x": 0, "y": 0, "width": 0, "height": 0}

    viewport_ratio = viewport_width / viewport_height
    if image_width / image_height > viewport_ratio:
        crop_height = image_height
        crop_width = min(image_width, max(1, round(image_height * viewport_ratio)))
    else:
        crop_width = image_width
        crop_height = min(image_height, max(1, round(image_width / viewport_ratio)))

    region_boxes = [
        region
        for person in result.get("persons", [])
        for region in person.get("regions", {}).values()
    ]
    all_region_bounds = bounds_for_region_boxes(region_boxes)
    has_hip_region = any(
        "hip" in person.get("regions", {})
        for person in result.get("persons", [])
    )
    priority_bounds = orientation_priority_bounds(result)
    if all_region_bounds is not None:
        target_left, target_top, target_right, target_bottom = all_region_bounds
        all_regions_fit = (
            target_right - target_left <= crop_width
            and target_bottom - target_top <= crop_height
        )
        back_hips = back_hip_bounds(result)
        if not all_regions_fit and back_hips is not None:
            hip_left, hip_top, hip_right, hip_bottom = back_hips
            return {
                "x": position_crop_axis(hip_left, hip_right, image_width, crop_width),
                "y": position_crop_axis(hip_top, hip_bottom, image_height, crop_height),
                "width": crop_width,
                "height": crop_height,
            }
        crop_x = position_crop_axis(target_left, target_right, image_width, crop_width)
        chest_only = (
            priority_bounds is not None
            and not has_hip_region
            and any("chest" in person.get("regions", {}) for person in result.get("persons", []))
        )
        crop_y = position_crop_axis(
            target_top,
            target_bottom,
            image_height,
            crop_height,
            preferred_start=(
                priority_bounds[1] - crop_height * CHEST_TOP_FRAME_RATIO
                if chest_only and priority_bounds is not None
                else None
            ),
        )
        if priority_bounds is not None:
            priority_left, priority_top, priority_right, priority_bottom = priority_bounds
            if target_right - target_left > crop_width:
                crop_x = position_crop_axis(
                    priority_left,
                    priority_right,
                    image_width,
                    crop_width,
                    preferred_start=crop_x,
                )
            if target_bottom - target_top > crop_height:
                crop_y = position_crop_axis(
                    priority_top,
                    priority_bottom,
                    image_height,
                    crop_height,
                    preferred_start=crop_y,
                )
        return {
            "x": crop_x,
            "y": crop_y,
            "width": crop_width,
            "height": crop_height,
        }

    return {
        "x": position_crop_axis(image_width / 2.0, image_width / 2.0, image_width, crop_width),
        "y": position_crop_axis(image_height / 2.0, image_height / 2.0, image_height, crop_height),
        "width": crop_width,
        "height": crop_height,
    }


def analyze_result(
    result: dict[str, Any],
    image_size: tuple[int, int],
    viewport_size: tuple[int, int] = DEFAULT_WINDOW_SIZE,
) -> dict[str, Any]:
    for person in result.get("persons", []):
        person["keypoints"] = complete_shoulder_keypoints(
            person.get("keypoints", {}),
            person.get("box"),
            image_size,
        )
        person["regions"] = body_regions_for_keypoints(
            person["keypoints"],
            image_size,
        )

    background_crop = background_crop_for_result(result, image_size, viewport_size)
    result["background_crop"] = background_crop
    result["bounds"] = background_crop
    return result


def detect_image(
    model: YOLO,
    image_path: Path,
    device: str,
    score_threshold: float,
    orientation_classifier: OrientationClassifier | None = None,
    include_debug_overlay: bool = False,
    viewport_size: tuple[int, int] = DEFAULT_WINDOW_SIZE,
) -> dict[str, Any]:
    started_at = time.perf_counter()
    with Image.open(image_path) as source:
        image = source.convert("RGB")
        image_size = image.size

    predictions = list(model.predict(
        source=str(image_path),
        device=device,
        conf=score_threshold,
        verbose=False,
    ))
    prediction: Any = predictions[0] if predictions else None
    persons: list[dict[str, Any]] = []
    if prediction is not None and prediction.boxes is not None and prediction.keypoints is not None:
        boxes = prediction.boxes.xyxy.detach().cpu().tolist()
        box_confidences = prediction.boxes.conf.detach().cpu().tolist()
        keypoint_data = prediction.keypoints.data.detach().cpu().tolist()
        for index, (box, person_confidence, keypoints) in enumerate(
            zip(boxes, box_confidences, keypoint_data)
        ):
            persons.append(
                {
                    "index": index,
                    "box": {
                        "x": int(round(box[0])),
                        "y": int(round(box[1])),
                        "width": int(round(box[2] - box[0])),
                        "height": int(round(box[3] - box[1])),
                    },
                    "confidence": float(person_confidence),
                    "keypoints": {
                        name: {
                            "x": float(point[0]),
                            "y": float(point[1]),
                            "confidence": float(point[2]),
                        }
                        for name, point in zip(KEYPOINT_NAMES, keypoints)
                    },
                }
            )

    result = {
        "image": str(image_path),
        "device": device,
        "model": str(getattr(model, "ckpt", "")),
        "detected": bool(persons),
        "persons": persons,
    }
    classify_person_orientations(result, image, orientation_classifier)
    result = analyze_result(result, image_size, viewport_size)
    if include_debug_overlay:
        result["debug_overlay"] = encode_detection_overlay(result, image_size, viewport_size)
        result["debug_overlay_size"] = [image_size[0], image_size[1]]
    result["recognition_elapsed_seconds"] = round(time.perf_counter() - started_at, 3)
    return result


def run_server(
    model: YOLO,
    device: str,
    score_threshold: float,
    orientation_classifier: OrientationClassifier | None,
    pose_model_path: Path,
    orientation_model_path: Path | None,
) -> int:
    LOGGER.info(
        "视觉识别服务已就绪，device=%s，pose_model=%s，orientation_model=%s",
        device,
        pose_model_path,
        orientation_model_path or "<none>",
    )
    print(
        json.dumps(
            {
                "ready": True,
                "protocol": 1,
                "device": device,
                "model": str(pose_model_path),
                "orientation_model": str(orientation_model_path or ""),
                "orientation_enabled": orientation_classifier is not None,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    for raw_line in sys.stdin:
        raw_request = raw_line.strip()
        if not raw_request:
            continue
        image_path = raw_request
        viewport_size = DEFAULT_WINDOW_SIZE
        if raw_request.startswith("{"):
            try:
                request = json.loads(raw_request)
                image_path = str(request.get("image", "")).strip()
                requested_viewport_size = request.get("viewport_size")
                if (
                    isinstance(requested_viewport_size, list)
                    and len(requested_viewport_size) == 2
                    and all(isinstance(value, int) for value in requested_viewport_size)
                    and requested_viewport_size[0] > 0
                    and requested_viewport_size[1] > 0
                ):
                    viewport_size = (
                        requested_viewport_size[0],
                        requested_viewport_size[1],
                    )
            except (TypeError, ValueError, json.JSONDecodeError) as error:
                LOGGER.error("无法解析视觉识别请求：%s", error)
                print(json.dumps({"error": str(error), "detected": False}), flush=True)
                continue
        if not image_path:
            continue
        if image_path == "__quit__":
            return 0
        request_started_at = time.perf_counter()
        try:
            result = detect_image(
                model,
                Path(image_path),
                device,
                score_threshold,
                orientation_classifier,
                include_debug_overlay=True,
                viewport_size=viewport_size,
            )
        except Exception as error:
            LOGGER.exception("检测图像失败：%s", image_path)
            result = {
                "image": image_path,
                "error": str(error),
                "detected": False,
                "recognition_elapsed_seconds": round(time.perf_counter() - request_started_at, 3),
            }
        LOGGER.info(
            "视觉识别请求结束：%s，耗时 %.3f 秒，成功=%s",
            image_path,
            result["recognition_elapsed_seconds"],
            "error" not in result,
        )
        print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0


# ---------------------------------------------------------------------------
# 独立 HTTP 背景图服务(--http 模式)
#
# 替代旧的 NteModBgServer.exe:同一进程内完成「图库轮换 + YOLO 检测 + 裁剪编码」,
# 外部程序直接调用,无需 Electron 壳。接口与原服务保持一致:
#   GET /background?width=<宽>&height=<高>[&format=png][&meta=1]
#       返回按视口比例、以 AI 识别焦点为中心裁剪好的图片字节(可直接用作背景);
#       响应头 X-Background-Generation 标换代,
#       X-Detection-Pending: 1 表示检测尚未就绪、本次为图心回退裁剪(稍后重取即可)。
#   GET /health → 运行状态 JSON。
# 配置:NTEMM_CONFIG / --config 指定 ini(缺省 ~/.ntemm/NteModManager.ini),
# 读取 [Paths] background_images_directory、[Debug] test_images、[BgServer] port。
# ---------------------------------------------------------------------------

DEFAULT_HTTP_PORT = 26925
TEST_IMAGES_ROOT = Path("F:/pictures/test")
DETECTION_WAIT_TIMEOUT_SECONDS = 15.0
MODEL_READY_TIMEOUT_SECONDS = 120.0
JPEG_QUALITY = 92
MAX_ENCODE_CACHE_ENTRIES = 8
MAX_VIEWPORT_EDGE = 16384


def resolve_config_path(explicit: Path | None) -> Path | None:
    if explicit is not None:
        return explicit
    override = os.environ.get("NTEMM_CONFIG", "").strip()
    if override:
        return Path(override.replace("\\", "/"))
    return Path.home() / ".ntemm" / "NteModManager.ini"


def read_ini_sections(config_path: Path | None) -> dict[str, dict[str, str]]:
    if config_path is None or not config_path.is_file():
        return {}
    parser = configparser.ConfigParser(interpolation=None)
    try:
        parser.read(config_path, encoding="utf-8")
    except (OSError, configparser.Error) as error:
        LOGGER.warning("读取配置 %s 失败：%s", config_path, error)
        return {}
    return {section: dict(parser.items(section)) for section in parser.sections()}


def ini_value(sections: dict[str, dict[str, str]], section: str, key: str) -> str:
    raw = str(sections.get(section, {}).get(key, "")).strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {'"', "'"}:
        raw = raw[1:-1].strip()
    return raw


def ini_bool(sections: dict[str, dict[str, str]], section: str, key: str) -> bool:
    raw = ini_value(sections, section, key).lower()
    return raw in {"1", "true"}


def collect_http_background_images(
    images_dir: Path | None,
    sections: dict[str, dict[str, str]],
) -> list[Path]:
    """与主程序 collectBackgroundImages 一致:数值命名子目录中的 jpg/png。

    显式给 --images-dir 时优先用它,且没有数值子目录时退回平铺收集,方便临时指一个图库。
    """
    if images_dir is not None:
        try:
            subdirectories = sorted(
                entry.name
                for entry in images_dir.iterdir()
                if entry.is_dir() and entry.name.isdigit()
            )
        except OSError:
            subdirectories = []
        if subdirectories:
            images = [
                path
                for name in subdirectories
                for path in sorted((images_dir / name).iterdir())
                if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
            ]
        else:
            images = sorted(
                path
                for path in images_dir.iterdir()
                if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
            )
        if not images:
            LOGGER.warning("--images-dir 目录中没有可用的 jpg/png 图片：%s", images_dir)
        return images

    if ini_bool(sections, "Debug", "test_images"):
        images = sorted(
            path
            for path in TEST_IMAGES_ROOT.iterdir()
            if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
        ) if TEST_IMAGES_ROOT.is_dir() else []
        if not images:
            LOGGER.warning(
                "测试图片模式已开启，但 %s 没有可用的 jpg/png 图片；将忽略 background_images_directory",
                TEST_IMAGES_ROOT,
            )
        return images

    root_value = ini_value(sections, "Paths", "background_images_directory")
    if not root_value:
        return []
    root = Path(root_value)
    try:
        subdirectories = sorted(
            entry.name for entry in root.iterdir() if entry.is_dir() and entry.name.isdigit()
        )
    except OSError:
        LOGGER.warning("无法读取背景图目录：%s", root)
        return []
    images: list[Path] = []
    for name in subdirectories:
        try:
            images.extend(
                path
                for path in sorted((root / name).iterdir())
                if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
            )
        except OSError:
            continue
    if not images:
        LOGGER.warning(
            "背景图目录中没有可用的图片：%s（需要数值命名的子目录，内含 jpg/jpeg/png 文件）", root
        )
    return images


class HttpModelHolder:
    """后台线程加载模型;HTTP 请求线程等 ready 后以全局锁串行检测。"""

    def __init__(self, arguments: argparse.Namespace) -> None:
        self._arguments = arguments
        self._device = "cpu"
        self._model: YOLO | None = None
        self._orientation: OrientationClassifier | None = None
        self._error: str | None = None
        self._state_lock = threading.Lock()
        self._infer_lock = threading.Lock()
        self._ready = threading.Event()

    def start_loading(self) -> None:
        threading.Thread(target=self._load, name="model-loader", daemon=True).start()

    def _load(self) -> None:
        try:
            device = select_device(self._arguments.device)
            model = load_model(self._arguments.model, self._arguments.cache_dir)
            orientation = load_orientation_classifier(self._arguments.orientation_model, device)
            if orientation is not None:
                orientation.confidence_threshold = self._arguments.orientation_confidence_threshold
            with self._state_lock:
                self._device = device
                self._model = model
                self._orientation = orientation
            LOGGER.info("视觉识别模型加载完成，device=%s", device)
        except Exception as error:
            LOGGER.exception("视觉识别模型加载失败")
            with self._state_lock:
                self._error = str(error)
        finally:
            # 失败也要唤醒等待者:之后 detect() 会抛错,请求回退到图心裁剪
            self._ready.set()

    def ready(self) -> bool:
        with self._state_lock:
            return self._model is not None

    def wait_ready(self, timeout: float | None = None) -> bool:
        return self._ready.wait(timeout)

    def detect(self, image_path: Path, viewport_size: tuple[int, int]) -> dict[str, Any]:
        if not self._ready.wait(MODEL_READY_TIMEOUT_SECONDS):
            raise RuntimeError("模型加载超时")
        with self._state_lock:
            model = self._model
            orientation = self._orientation
            error = self._error
        if model is None:
            raise RuntimeError(f"模型加载失败：{error}")
        # YOLO 推理不加锁并发会互相干扰;与主程序的请求串行化语义一致
        with self._infer_lock:
            return detect_image(
                model,
                image_path,
                self._device,
                self._arguments.score_threshold,
                orientation,
                include_debug_overlay=False,
                viewport_size=viewport_size,
            )


def image_pixel_size(image_path: Path) -> tuple[int, int] | None:
    try:
        with Image.open(image_path) as source:
            return source.size
    except OSError as error:
        LOGGER.warning("无法读取背景图片：%s（%s）", image_path, error)
        return None


class BackgroundHttpService:
    """10 秒轮换持有「当前背景」,按 (图, 视口) 缓存 AI 裁剪矩形与编码结果。"""

    def __init__(
        self,
        detector: HttpModelHolder,
        images_dir: Path | None,
        sections: dict[str, dict[str, str]],
        rotation_interval: float,
    ) -> None:
        self.detector = detector
        self.images_dir = images_dir
        self.sections = sections
        self.rotation_interval = max(1.0, rotation_interval)
        self.stop_event = threading.Event()
        self._lock = threading.Lock()
        self.images: list[Path] = []
        self.current_path: Path | None = None
        self.current_size: tuple[int, int] = (0, 0)
        self.generation = 0
        self.crops: dict[tuple[str, str], dict[str, int]] = {}
        self.pending: dict[tuple[str, str], threading.Event] = {}
        self.last_viewport: tuple[int, int] | None = None
        self._encode_cache: OrderedDict[str, tuple[bytes, int, int]] = OrderedDict()

    def start(self) -> None:
        self.rotate()
        threading.Thread(target=self._rotation_loop, name="bg-rotation", daemon=True).start()

    def stop(self) -> None:
        self.stop_event.set()

    def _rotation_loop(self) -> None:
        while not self.stop_event.wait(self.rotation_interval):
            self.rotate()

    def rotate(self) -> None:
        images = collect_http_background_images(self.images_dir, self.sections)
        warmup_viewport: tuple[int, int] | None = None
        with self._lock:
            self.images = images
            if not images:
                if self.current_path is not None:
                    self.current_path = None
                    self.current_size = (0, 0)
                    self.crops.clear()
                    self._encode_cache.clear()
                    LOGGER.warning("背景图库为空，暂停提供背景；目录恢复后自动继续")
                return
            slot = self._pick_readable_image_locked(images)
            if slot is None:
                return
            path, size = slot
            if path == self.current_path:
                # 随机重选到同一张:保留已有检测结果,不换代
                return
            self.current_path = path
            self.current_size = size
            self.generation += 1
            self.crops.clear()
            self._encode_cache.clear()
            LOGGER.info("切换背景：%s（generation=%d）", path, self.generation)
            warmup_viewport = self.last_viewport or DEFAULT_WINDOW_SIZE
        # 锁外预热:用最近请求过的视口,在请求到来前把 AI 结果备好
        if warmup_viewport is not None:
            self._spawn_detection(path, warmup_viewport)

    def _pick_readable_image_locked(
        self, images: list[Path]
    ) -> tuple[Path, tuple[int, int]] | None:
        count = len(images)
        start = random.randrange(count)
        for offset in range(count):
            path = images[(start + offset) % count]
            size = image_pixel_size(path)
            if size is not None:
                return path, size
        return None

    def current_slot(self) -> tuple[Path | None, tuple[int, int], int]:
        with self._lock:
            return self.current_path, self.current_size, self.generation

    def health_snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "images": len(self.images),
                "current": self.current_path.name if self.current_path else None,
                "generation": self.generation if self.current_path else None,
                "modelReady": self.detector.ready(),
                "lastViewport": (
                    list(self.last_viewport) if self.last_viewport else None
                ),
            }

    def _viewport_key(self, viewport: tuple[int, int]) -> str:
        return f"{viewport[0]}x{viewport[1]}"

    def _spawn_detection(
        self, path: Path, viewport: tuple[int, int]
    ) -> threading.Event:
        key = (str(path), self._viewport_key(viewport))
        with self._lock:
            existing = self.pending.get(key)
            if existing is not None:
                return existing
            event = threading.Event()
            self.pending[key] = event
        threading.Thread(
            target=self._detect_worker,
            args=(path, viewport, key, event),
            name=f"bg-detect-{self._viewport_key(viewport)}",
            daemon=True,
        ).start()
        return event

    def _detect_worker(
        self,
        path: Path,
        viewport: tuple[int, int],
        key: tuple[str, str],
        event: threading.Event,
    ) -> None:
        try:
            result = self.detector.detect(path, viewport)
            crop = result.get("background_crop")
            if not isinstance(crop, dict):
                raise RuntimeError("检测结果缺少 background_crop")
            with self._lock:
                # 检测期间可能已轮换到下一张:过期结果直接丢弃
                if self.current_path == path:
                    self.crops[key] = crop
        except Exception as error:
            # 不缓存失败结果:下次请求重新检测
            LOGGER.error("背景识别失败：%s（%s）", path, error)
        finally:
            with self._lock:
                self.pending.pop(key, None)
            event.set()

    def ensure_crop(
        self, path: Path, viewport: tuple[int, int]
    ) -> tuple[dict[str, int] | None, bool]:
        key = (str(path), self._viewport_key(viewport))
        with self._lock:
            crop = self.crops.get(key)
        if crop is not None:
            return crop, False
        event = self._spawn_detection(path, viewport)
        if event.wait(DETECTION_WAIT_TIMEOUT_SECONDS):
            with self._lock:
                crop = self.crops.get(key)
            if crop is not None:
                return crop, False
        # 检测未就绪:调用方先取图心回退裁剪,后台检测完成后缓存生效
        return None, True

    def record_viewport(self, viewport: tuple[int, int]) -> None:
        with self._lock:
            self.last_viewport = viewport

    def encode_crop(
        self, path: Path, crop: dict[str, int], fmt: str
    ) -> tuple[bytes, int, int] | None:
        key = f"{crop['x']},{crop['y']},{crop['width']},{crop['height']}:{fmt}"
        with self._lock:
            cached = self._encode_cache.get(key)
            if cached is not None:
                self._encode_cache.move_to_end(key)
                return cached
        box = (crop["x"], crop["y"], crop["x"] + crop["width"], crop["y"] + crop["height"])
        try:
            with Image.open(path) as source:
                image = source
                if fmt == "jpeg" and image.mode not in ("RGB", "L"):
                    image = image.convert("RGB")
                cropped = image.crop(box)
                buffer = io.BytesIO()
                if fmt == "png":
                    cropped.save(buffer, format="PNG", optimize=True)
                else:
                    cropped.save(buffer, format="JPEG", quality=JPEG_QUALITY)
                entry = (buffer.getvalue(), cropped.width, cropped.height)
        except (OSError, ValueError) as error:
            LOGGER.error("背景图裁剪/编码失败：%s（%s）", path, error)
            return None
        with self._lock:
            self._encode_cache[key] = entry
            while len(self._encode_cache) > MAX_ENCODE_CACHE_ENTRIES:
                self._encode_cache.popitem(last=False)
        return entry


class BackgroundHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    # Windows 的 SO_REUSEADDR 允许重复绑定同一端口,会静默双实例;
    # 关掉它,端口被占用时 bind 直接抛错退出(单例语义与原服务一致)
    allow_reuse_address = False

    def __init__(self, address: tuple[str, int], handler: type[BaseHTTPRequestHandler], service: BackgroundHttpService) -> None:
        super().__init__(address, handler)
        self.service = service


class BackgroundHttpRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.debug("HTTP %s", format % args)

    def _cors_headers(self) -> dict[str, str]:
        return {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
        }

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        for name, value in self._cors_headers().items():
            self.send_header(name, value)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        try:
            self._dispatch()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            LOGGER.exception("背景服务请求处理失败")
            self._respond_text(500, f"Internal Server Error: {error}")

    def _respond_text(self, status: int, message: str) -> None:
        body = message.encode("utf-8")
        self.send_response(status)
        for name, value in self._cors_headers().items():
            self.send_header(name, value)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _dispatch(self) -> None:
        if self.command == "OPTIONS":
            self.do_OPTIONS()
            return
        if self.command != "GET":
            self._respond_text(405, "Method Not Allowed")
            return
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/health":
            self._respond_health()
            return
        if parsed.path == "/background":
            self._respond_background(query)
            return
        self._respond_text(404, "Not Found。可用接口：/background?width=<宽>&height=<高>、/health")

    def _respond_health(self) -> None:
        service: BackgroundHttpService = self.server.service  # type: ignore[attr-defined]
        payload = {
            "ok": True,
            "service": "nte-bg-server",
            "port": self.server.server_address[1],  # type: ignore[attr-defined]
            **service.health_snapshot(),
        }
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        for name, value in self._cors_headers().items():
            self.send_header(name, value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _respond_background(self, query: dict[str, list[str]]) -> None:
        service: BackgroundHttpService = self.server.service  # type: ignore[attr-defined]
        path, size, generation = service.current_slot()
        if path is None:
            self._respond_text(
                503,
                "背景图库为空，请检查主程序 ini 的 Paths/background_images_directory",
            )
            return
        width = query_int(query, "width")
        height = query_int(query, "height")
        if width is None or height is None:
            self._respond_text(400, "需要正整数参数 width（窗口宽）与 height（窗口高）")
            return
        viewport = (width, height)
        service.record_viewport(viewport)

        crop, pending = service.ensure_crop(path, viewport)
        if crop is None:
            crop = background_crop_for_result({"persons": []}, size, viewport)
        if crop["width"] <= 0 or crop["height"] <= 0:
            self._respond_text(503, "背景裁剪失败，请稍后重试")
            return
        fmt = "png" if query.get("format", [""])[0] == "png" else "jpeg"
        encoded = service.encode_crop(path, crop, fmt)
        if encoded is None:
            self._respond_text(500, "背景图编码失败")
            return
        data, encoded_width, encoded_height = encoded

        def send_headers(extra: dict[str, str]) -> None:
            self.send_response(200)
            for name, value in self._cors_headers().items():
                self.send_header(name, value)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Background-Generation", str(generation))
            self.send_header("X-Detection-Pending", "1" if pending else "0")
            for name, value in extra.items():
                self.send_header(name, value)

        if query.get("meta", [""])[0] == "1":
            payload = {
                "generation": generation,
                "path": str(path),
                "imageWidth": size[0],
                "imageHeight": size[1],
                "crop": crop,
                "width": encoded_width,
                "height": encoded_height,
                "format": fmt,
                "detectionPending": pending,
                "data": base64.b64encode(data).decode("ascii"),
            }
            body = json.dumps(payload).encode("utf-8")
            send_headers({"Content-Type": "application/json; charset=utf-8"})
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        send_headers({
            "Content-Type": "image/png" if fmt == "png" else "image/jpeg",
        })
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def query_int(query: dict[str, list[str]], name: str) -> int | None:
    values = query.get(name)
    if not values:
        return None
    try:
        parsed = int(values[0], 10)
    except ValueError:
        return None
    return parsed if 0 < parsed <= MAX_VIEWPORT_EDGE else None


def resolve_http_port(
    arguments: argparse.Namespace, sections: dict[str, dict[str, str]]
) -> int:
    if arguments.port is not None:
        return arguments.port
    raw = os.environ.get("NTEMM_BG_SERVER_PORT", "").strip()
    if raw.isdigit() and 0 < int(raw) < 65536:
        return int(raw)
    raw = ini_value(sections, "BgServer", "port")
    if raw.isdigit() and 0 < int(raw) < 65536:
        return int(raw)
    return DEFAULT_HTTP_PORT


def run_http_server(arguments: argparse.Namespace) -> int:
    config_path = resolve_config_path(arguments.config)
    sections = read_ini_sections(config_path)
    port = resolve_http_port(arguments, sections)
    LOGGER.info("========== NTE 背景图 HTTP 服务启动 ==========")
    LOGGER.info(
        "配置文件：%s，图库目录覆盖：%s，端口：%d",
        config_path or "<缺省>",
        arguments.images_dir or "<ini>",
        port,
    )
    detector = HttpModelHolder(arguments)
    service = BackgroundHttpService(
        detector,
        arguments.images_dir,
        sections,
        arguments.rotation_interval,
    )
    service.start()
    detector.start_loading()
    try:
        server = BackgroundHttpServer(("127.0.0.1", port), BackgroundHttpRequestHandler, service)
    except OSError as error:
        # 端口被占用等监听失败时直接退出:静默存活却无法响应,比退出更难排查
        LOGGER.error("背景服务 HTTP 监听失败（端口 %d）：%s", port, error)
        service.stop()
        return 1
    LOGGER.info(
        "背景服务已监听 http://127.0.0.1:%d/background?width=<宽>&height=<高>[&format=png][&meta=1]",
        port,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("收到中断信号，退出背景服务")
    finally:
        service.stop()
        server.server_close()
    return 0


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run YOLO pose inference for NTE backgrounds")
    parser.add_argument("--server", action="store_true", help="stdio JSON 行协议模式（主程序使用）")
    parser.add_argument(
        "--http",
        action="store_true",
        help="HTTP 背景图服务模式（供外部程序调用，替代旧 NteModBgServer.exe）",
    )
    parser.add_argument("--port", type=int, default=None, help="HTTP 模式监听端口（默认 ini [BgServer] port > 26925）")
    parser.add_argument("--images-dir", type=Path, default=None, help="HTTP 模式背景图库目录（默认读 ini）")
    parser.add_argument("--config", type=Path, default=None, help="ini 配置路径（默认 NTEMM_CONFIG > ~/.ntemm/NteModManager.ini）")
    parser.add_argument("--rotation-interval", type=float, default=10.0, help="HTTP 模式背景轮换间隔秒数（默认 10）")
    parser.add_argument("--model", type=Path, default=Path(DEFAULT_MODEL))
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--orientation-model", type=Path, default=DEFAULT_ORIENTATION_MODEL)
    parser.add_argument("--orientation-confidence-threshold", type=float, default=ORIENTATION_CONFIDENCE_THRESHOLD)
    parser.add_argument("--score-threshold", type=float, default=0.45)
    return parser.parse_args()


def main() -> int:
    configure_logging()
    arguments = parse_arguments()
    resolved_model_path = resolve_model_path(arguments.model, arguments.cache_dir)
    log_startup_information(arguments, resolved_model_path)
    if arguments.http:
        # HTTP 模式的模型在后台线程加载,HTTP 立即可用;就绪前请求拿到回退裁剪
        return run_http_server(arguments)
    try:
        device = select_device(arguments.device)
        model = load_model(arguments.model, arguments.cache_dir)
        orientation_classifier = load_orientation_classifier(arguments.orientation_model, device)
        if orientation_classifier is not None:
            orientation_classifier.confidence_threshold = arguments.orientation_confidence_threshold
        LOGGER.info("配置：effective_device=%s，orientation_enabled=%s", device, orientation_classifier is not None)
    except Exception as error:
        LOGGER.exception("视觉识别模型初始化失败")
        if arguments.server:
            print(json.dumps({"ready": False, "error": str(error)}, ensure_ascii=False), flush=True)
        else:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    if arguments.http:
        return run_http_server(arguments)
    if arguments.server:
        return run_server(
            model,
            device,
            arguments.score_threshold,
            orientation_classifier,
            resolved_model_path,
            arguments.orientation_model,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
