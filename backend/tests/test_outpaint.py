from io import BytesIO

from PIL import Image

from app.routers.outpaint import expand_canvas


def png_bytes(width=10, height=8):
    image = Image.new("RGB", (width, height), (10, 20, 30))
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def test_expand_canvas_adds_masked_area_on_all_sides():
    expanded_bytes, mask_bytes = expand_canvas(png_bytes(), "all", 4)

    expanded = Image.open(BytesIO(expanded_bytes))
    mask = Image.open(BytesIO(mask_bytes))

    assert expanded.size == (18, 16)
    assert mask.size == (18, 16)
    assert mask.getpixel((0, 0)) == 255
    assert mask.getpixel((5, 5)) == 0


def test_expand_canvas_adds_masked_area_to_one_direction():
    expanded_bytes, mask_bytes = expand_canvas(png_bytes(), "left", 4)

    expanded = Image.open(BytesIO(expanded_bytes))
    mask = Image.open(BytesIO(mask_bytes))

    assert expanded.size == (14, 8)
    assert mask.getpixel((0, 0)) == 255
    assert mask.getpixel((5, 0)) == 0
