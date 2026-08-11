from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path
from typing import Any

import torch
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader
from torchvision import datasets, models, transforms
from torchvision.models import ConvNeXt_Tiny_Weights


TRAINING_ROOT = Path(__file__).resolve().parent
DEFAULT_DATASET = TRAINING_ROOT / "dataset"
DEFAULT_OUTPUT = TRAINING_ROOT / "checkpoints"
DEFAULT_CLASSES = ("front", "back", "uncertain")
DEFAULT_IMAGE_SIZE = 224
IMAGE_MEAN = (0.485, 0.456, 0.406)
IMAGE_STD = (0.229, 0.224, 0.225)
SUPPORTED_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png")


class OrientationClassifier:
    def __init__(
        self,
        model: nn.Module,
        class_names: tuple[str, ...],
        image_size: int,
        device: torch.device,
    ) -> None:
        self.model = model.to(device)
        self.model.eval()
        self.class_names = class_names
        self.image_size = image_size
        self.device = device
        self.transform = build_validation_transform(image_size)

    @classmethod
    def from_checkpoint(
        cls,
        checkpoint_path: Path,
        device: torch.device,
    ) -> "OrientationClassifier":
        checkpoint = torch.load(checkpoint_path, map_location=device)
        class_names = tuple(checkpoint["class_names"])
        validate_class_names(class_names)
        image_size = int(checkpoint["image_size"])
        model = build_model(len(class_names), pretrained=False)
        model.load_state_dict(checkpoint["model_state_dict"])
        return cls(model, class_names, image_size, device)

    def predict(self, image: Image.Image) -> tuple[str, float]:
        tensor = self.transform(image.convert("RGB"))
        if not isinstance(tensor, torch.Tensor):
            raise TypeError("Image transform did not return a tensor")
        tensor = tensor.unsqueeze(0).to(self.device)
        with torch.inference_mode():
            probabilities = torch.softmax(self.model(tensor), dim=1)[0]
        confidence, index = probabilities.max(dim=0)
        return self.class_names[int(index.item())], float(confidence.item())


def build_training_transform(image_size: int) -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.RandomResizedCrop(image_size, scale=(0.75, 1.0), ratio=(0.8, 1.25)),
            transforms.RandomHorizontalFlip(),
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
            transforms.RandomRotation(8),
            transforms.ToTensor(),
            transforms.Normalize(IMAGE_MEAN, IMAGE_STD),
        ]
    )


def build_validation_transform(image_size: int) -> transforms.Compose:
    resize_size = math.ceil(image_size * 1.14)
    return transforms.Compose(
        [
            transforms.Resize(resize_size),
            transforms.CenterCrop(image_size),
            transforms.ToTensor(),
            transforms.Normalize(IMAGE_MEAN, IMAGE_STD),
        ]
    )


def build_model(num_classes: int, pretrained: bool) -> nn.Module:
    weights = ConvNeXt_Tiny_Weights.DEFAULT if pretrained else None
    model = models.convnext_tiny(weights=weights)
    classifier = model.classifier[2]
    if not isinstance(classifier, nn.Linear):
        raise TypeError("Unexpected ConvNeXt classifier structure")
    model.classifier[2] = nn.Linear(classifier.in_features, num_classes)
    return model


def select_device(requested: str) -> torch.device:
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested, but no CUDA device is available")
        return torch.device("cuda")
    if requested == "cpu":
        return torch.device("cpu")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def validate_class_names(class_names: tuple[str, ...]) -> None:
    if "side" in class_names:
        raise ValueError(
            "The side class is no longer supported. Move side images to uncertain and retrain."
        )


def configure_device(device: torch.device) -> None:
    if device.type != "cuda":
        return
    torch.backends.cudnn.benchmark = True
    torch.set_float32_matmul_precision("high")


def validate_dataset(dataset_root: Path, class_names: tuple[str, ...]) -> None:
    missing_splits = [split for split in ("train", "val") if not (dataset_root / split).is_dir()]
    if missing_splits:
        raise FileNotFoundError(
            f"Dataset must contain train and val directories; missing: {', '.join(missing_splits)}"
        )

    missing_classes = [
        class_name
        for split in ("train", "val")
        for class_name in class_names
        if not (dataset_root / split / class_name).is_dir()
    ]
    if missing_classes:
        raise FileNotFoundError(
            "Dataset is missing class directories: " + ", ".join(sorted(set(missing_classes)))
        )

    empty_classes = []
    for split in ("train", "val"):
        for class_name in class_names:
            class_directory = dataset_root / split / class_name
            has_image = any(
                path.is_file() and path.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS
                for path in class_directory.rglob("*")
            )
            if not has_image:
                empty_classes.append(f"{split}/{class_name}")
    if empty_classes:
        supported_extensions = ", ".join(SUPPORTED_IMAGE_EXTENSIONS)
        raise FileNotFoundError(
            "No supported image files were found in: "
            + ", ".join(empty_classes)
            + f". Add images to each directory. Supported extensions: {supported_extensions}"
        )


def build_datasets(
    dataset_root: Path,
    class_names: tuple[str, ...],
    image_size: int,
) -> tuple[datasets.ImageFolder, datasets.ImageFolder]:
    validate_dataset(dataset_root, class_names)
    train_dataset = datasets.ImageFolder(
        dataset_root / "train",
        transform=build_training_transform(image_size),
    )
    val_dataset = datasets.ImageFolder(
        dataset_root / "val",
        transform=build_validation_transform(image_size),
    )
    expected_classes = list(class_names)
    if train_dataset.classes != sorted(expected_classes) or val_dataset.classes != sorted(expected_classes):
        raise ValueError(
            "Dataset classes do not match the requested classes. "
            f"Expected {sorted(expected_classes)}, got train={train_dataset.classes}, "
            f"val={val_dataset.classes}"
        )
    if train_dataset.class_to_idx != val_dataset.class_to_idx:
        raise ValueError("train and val class-to-index mappings differ")
    return train_dataset, val_dataset


def freeze_backbone(model: nn.Module) -> None:
    features = model.features
    if not isinstance(features, nn.Module):
        raise TypeError("Unexpected ConvNeXt features structure")
    for parameter in features.parameters():
        parameter.requires_grad = False


def build_class_weights(
    train_dataset: datasets.ImageFolder,
    num_classes: int,
) -> torch.Tensor:
    class_counts = torch.bincount(
        torch.tensor(train_dataset.targets, dtype=torch.long),
        minlength=num_classes,
    ).to(torch.float32)
    if torch.any(class_counts == 0):
        raise ValueError("Cannot build class weights for an empty class")
    return class_counts.sum() / (num_classes * class_counts)


def run_epoch(
    model: nn.Module,
    data_loader: DataLoader[Any],
    criterion: nn.Module,
    optimizer: torch.optim.Optimizer | None,
    device: torch.device,
    scaler: torch.amp.GradScaler,
) -> dict[str, float]:
    training = optimizer is not None
    model.train(training)
    total_loss = 0.0
    correct = 0
    total = 0
    use_amp = device.type == "cuda"

    for images, labels in data_loader:
        images = images.to(device, non_blocking=use_amp)
        labels = labels.to(device, non_blocking=use_amp)
        if training:
            optimizer.zero_grad(set_to_none=True)

        with torch.amp.autocast(device_type=device.type, enabled=use_amp):
            logits = model(images)
            loss = criterion(logits, labels)

        if training:
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()

        batch_size = labels.size(0)
        total_loss += loss.item() * batch_size
        correct += (logits.argmax(dim=1) == labels).sum().item()
        total += batch_size

    if total == 0:
        raise RuntimeError("The dataset contains no images")
    return {"loss": total_loss / total, "accuracy": correct / total}


def save_checkpoint(
    output_path: Path,
    model: nn.Module,
    class_names: tuple[str, ...],
    image_size: int,
    epoch: int,
    metrics: dict[str, float],
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "class_names": list(class_names),
            "image_size": image_size,
            "epoch": epoch,
            "metrics": metrics,
            "normalization": {"mean": IMAGE_MEAN, "std": IMAGE_STD},
        },
        output_path,
    )


def train(arguments: argparse.Namespace) -> int:
    device = select_device(arguments.device)
    configure_device(device)
    class_names = tuple(arguments.classes.split(","))
    if not all(class_names) or len(set(class_names)) != len(class_names):
        raise ValueError("--classes must contain unique non-empty names")
    validate_class_names(class_names)

    train_dataset, val_dataset = build_datasets(
        arguments.dataset,
        class_names,
        arguments.image_size,
    )
    class_names = tuple(train_dataset.classes)
    loader_options: dict[str, Any] = {
        "batch_size": arguments.batch_size,
        "num_workers": arguments.workers,
        "pin_memory": device.type == "cuda",
    }
    if arguments.workers > 0:
        loader_options.update({"persistent_workers": True, "prefetch_factor": 2})
    train_loader = DataLoader(train_dataset, shuffle=True, **loader_options)
    val_loader = DataLoader(val_dataset, shuffle=False, **loader_options)

    model = build_model(len(class_names), pretrained=not arguments.from_scratch).to(device)
    model_device = next(model.parameters()).device
    if model_device.type != device.type or (
        device.index is not None and model_device.index != device.index
    ):
        raise RuntimeError(f"Model is on {model_device}, but training device is {device}")
    if arguments.freeze_backbone:
        freeze_backbone(model)
    trainable_parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
    optimizer = torch.optim.AdamW(
        trainable_parameters,
        lr=arguments.learning_rate,
        weight_decay=arguments.weight_decay,
    )
    class_weights = (
        build_class_weights(train_dataset, len(class_names))
        if arguments.class_weighting
        else None
    )
    train_criterion = nn.CrossEntropyLoss(
        weight=class_weights.to(device) if class_weights is not None else None,
    )
    val_criterion = nn.CrossEntropyLoss()
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    best_accuracy = -1.0
    history: list[dict[str, float | int]] = []
    started_at = time.perf_counter()

    print(f"Training ConvNeXt-Tiny on {device}")
    if device.type == "cuda":
        print(f"CUDA device: {torch.cuda.get_device_name(device)}")
        print(f"CUDA capability: {torch.cuda.get_device_capability(device)}")
    print(f"Model parameter device: {model_device}")
    print(f"DataLoader workers: {arguments.workers}, batch size: {arguments.batch_size}")
    print(f"Classes: {', '.join(class_names)}")
    print(f"Images: train={len(train_dataset)}, val={len(val_dataset)}")
    print(f"Backbone frozen: {arguments.freeze_backbone}")
    print(f"Class weighting: {arguments.class_weighting}")
    if class_weights is not None:
        print("Class weights: " + ", ".join(
            f"{name}={weight:.3f}" for name, weight in zip(class_names, class_weights.tolist())
        ))
    for epoch in range(1, arguments.epochs + 1):
        train_metrics = run_epoch(model, train_loader, train_criterion, optimizer, device, scaler)
        with torch.inference_mode():
            val_metrics = run_epoch(model, val_loader, val_criterion, None, device, scaler)
        metrics = {
            "epoch": epoch,
            "train_loss": train_metrics["loss"],
            "train_accuracy": train_metrics["accuracy"],
            "val_loss": val_metrics["loss"],
            "val_accuracy": val_metrics["accuracy"],
        }
        history.append(metrics)
        print(
            f"[{epoch:03d}/{arguments.epochs:03d}] "
            f"train loss={metrics['train_loss']:.4f} acc={metrics['train_accuracy']:.3f} | "
            f"val loss={metrics['val_loss']:.4f} acc={metrics['val_accuracy']:.3f}"
        )

        save_checkpoint(
            arguments.output / "last.pt",
            model,
            class_names,
            arguments.image_size,
            epoch,
            metrics,
        )
        if metrics["val_accuracy"] > best_accuracy:
            best_accuracy = metrics["val_accuracy"]
            save_checkpoint(
                arguments.output / "best.pt",
                model,
                class_names,
                arguments.image_size,
                epoch,
                metrics,
            )

    (arguments.output / "history.json").write_text(
        json.dumps(history, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Saved checkpoints to {arguments.output}")
    if device.type == "cuda":
        peak_memory = torch.cuda.max_memory_allocated(device) / (1024 ** 3)
        print(f"Peak CUDA memory: {peak_memory:.2f} GiB")
    print(f"Total elapsed: {time.perf_counter() - started_at:.1f}s")
    return 0


def predict(arguments: argparse.Namespace) -> int:
    device = select_device(arguments.device)
    classifier = OrientationClassifier.from_checkpoint(arguments.checkpoint, device)
    with Image.open(arguments.image) as image:
        label, confidence = classifier.predict(image)
    print(json.dumps({"orientation": label, "confidence": confidence}, ensure_ascii=False))
    return 0


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train or run ConvNeXt human orientation classifier")
    parser.add_argument("--mode", choices=("train", "predict"), default="train")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--image", type=Path)
    parser.add_argument("--classes", default=",".join(DEFAULT_CLASSES))
    parser.add_argument("--image-size", type=int, default=DEFAULT_IMAGE_SIZE)
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--freeze-backbone", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--class-weighting", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--from-scratch", action="store_true")
    arguments = parser.parse_args()
    if arguments.mode == "predict" and (arguments.checkpoint is None or arguments.image is None):
        parser.error("--mode predict requires --checkpoint and --image")
    if arguments.image_size <= 0 or arguments.epochs <= 0 or arguments.batch_size <= 0:
        parser.error("image size, epochs, and batch size must be positive")
    return arguments


def main() -> int:
    arguments = parse_arguments()
    return train(arguments) if arguments.mode == "train" else predict(arguments)


if __name__ == "__main__":
    raise SystemExit(main())
