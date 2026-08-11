from __future__ import annotations

import argparse
import base64
import io
import json
import logging
import platform
import sys
import time
from pathlib import Path
from typing import Any

import torch
from PIL import Image, ImageDraw
from ultralytics import YOLO
from torchvision import models, transforms


LOGGER = logging.getLogger("visual_region_detector")


def configure_logging() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="backslashreplace")
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
        "配置：server=%s，requested_device=%s，score_threshold=%.3f，orientation_confidence_threshold=%.3f",
        arguments.server,
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


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run YOLO pose inference for NTE backgrounds")
    parser.add_argument("--server", action="store_true")
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
