"""Generate crisp multi-resolution Kiroku Note application and browser extension icons with Hiragana 'あ' in vibrant orange."""
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = PROJECT_ROOT / "assets"
EXTENSION_ICONS_DIR = PROJECT_ROOT / "extension" / "icons"

ASSETS_DIR.mkdir(parents=True, exist_ok=True)
EXTENSION_ICONS_DIR.mkdir(parents=True, exist_ok=True)

# Candidate Japanese font paths on Windows
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\NotoSansJP-VF.ttf",
    r"C:\Windows\Fonts\YuGothB.ttc",
    r"C:\Windows\Fonts\meiryob.ttc",
    r"C:\Windows\Fonts\BIZ-UDGothicB.ttc",
    r"C:\Windows\Fonts\msgothic.ttc",
]

def get_japanese_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for font_path in FONT_CANDIDATES:
        if os.path.exists(font_path):
            try:
                return ImageFont.truetype(font_path, size)
            except Exception:
                continue
    try:
        return ImageFont.load_default()
    except Exception:
        return ImageFont.load_default()

def render_hiragana_a_image(size: int = 256) -> Image.Image:
    """Render a high-resolution square icon with Hiragana 'あ' in warm vibrant orange against a lighter, high-contrast dark tile."""
    # 4x supersampling for ultra crisp anti-aliasing
    scale = 4
    canvas_size = size * scale
    
    # Transparent base
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Rounded container parameters
    margin = int(canvas_size * 0.05)
    radius = int(canvas_size * 0.22)
    
    # Background: Lighter rich charcoal/slate tile (#2D2925) with crisp outline (#61564C)
    bg_box = (margin, margin, canvas_size - margin, canvas_size - margin)
    draw.rounded_rectangle(
        bg_box,
        radius=radius,
        fill=(45, 41, 37, 255),
        outline=(97, 86, 76, 255),
        width=max(1, int(4 * scale))
    )
    
    # Inner subtle warm ring for depth
    inner_margin = margin + int(5 * scale)
    inner_radius = max(1, radius - int(5 * scale))
    draw.rounded_rectangle(
        (inner_margin, inner_margin, canvas_size - inner_margin, canvas_size - inner_margin),
        radius=inner_radius,
        outline=(65, 59, 53, 255),
        width=max(1, int(2 * scale))
    )
    
    # Character 'あ'
    char = "あ"
    font_size = int(canvas_size * 0.58)
    font = get_japanese_font(font_size)
    
    # Measure text bounding box
    bbox = draw.textbbox((0, 0), char, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    
    # Center coordinates with slight optical vertical adjustment (-2% shift for 'あ' visual weight)
    x = (canvas_size - text_w) // 2 - bbox[0]
    y = (canvas_size - text_h) // 2 - bbox[1] - int(canvas_size * 0.02)
    
    # Text Color: Ultra-vibrant luminous Japanese orange (#FF6A13 / (255, 106, 19))
    orange_color = (255, 106, 19, 255)
    
    # Draw character with slight shadow for depth
    shadow_offset = max(1, int(2 * scale))
    draw.text((x + shadow_offset, y + shadow_offset), char, font=font, fill=(20, 18, 16, 200))
    draw.text((x, y), char, font=font, fill=orange_color)
    
    # Downsample using high-quality Lanczos resampling
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

def generate_assets():
    png_path = ASSETS_DIR / "icon.png"
    ico_path = ASSETS_DIR / "icon.ico"
    
    # Generate master 256x256 image
    master_img = render_hiragana_a_image(256)
    master_img.save(png_path, format="PNG")
    print(f"Saved PNG icon: {png_path}")
    
    # Generate multi-size ICO: 16, 24, 32, 48, 64, 128, 256
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master_img.save(ico_path, format="ICO", sizes=sizes)
    print(f"Saved ICO icon with {len(sizes)} sizes: {ico_path}")

    # Generate browser extension icons: 16x16, 48x48, 128x128
    for ext_size in [16, 48, 128]:
        ext_img = render_hiragana_a_image(ext_size)
        ext_target = EXTENSION_ICONS_DIR / f"icon{ext_size}.png"
        ext_img.save(ext_target, format="PNG")
        print(f"Saved Extension icon: {ext_target}")

if __name__ == "__main__":
    generate_assets()
