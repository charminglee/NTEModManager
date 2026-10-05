from PIL import Image

image = Image.open("img/nte-mod-manager.png")

image.save(
    "img/nte-mod-manager.ico",
    format="ICO",
    sizes=[
        (16, 16),
        (24, 24),
        (32, 32),
        (48, 48),
        (64, 64),
        (128, 128),
        (256, 256),
    ]
)