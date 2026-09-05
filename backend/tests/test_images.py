"""Uploads are shrunk on the way in, and the awkward cases still work."""

import io

import pytest
from PIL import Image

from app.services.images import optimise


def jpeg(width: int, height: int, quality: int = 95) -> bytes:
    im = Image.new("RGB", (width, height))
    px = im.load()
    for y in range(0, height, 4):
        for x in range(0, width, 4):
            px[x, y] = ((x * 7) % 256, (y * 5) % 256, ((x + y) * 3) % 256)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def test_a_phone_photo_shrinks_dramatically():
    raw = jpeg(3024, 4032)
    out, ext = optimise(raw, "player")

    assert ext == ".jpg"
    assert len(out) < len(raw) * 0.1, "a phone photo should lose most of its weight"
    with Image.open(io.BytesIO(out)) as im:
        assert max(im.size) <= 900


def test_a_portrait_stays_a_portrait():
    out, _ = optimise(jpeg(2000, 3000), "player")
    with Image.open(io.BytesIO(out)) as im:
        assert im.height > im.width


def test_a_small_photo_is_not_enlarged():
    out, _ = optimise(jpeg(300, 400), "player")
    with Image.open(io.BytesIO(out)) as im:
        assert im.size == (300, 400), "upscaling would only add weight, not detail"


def test_a_logo_keeps_its_transparency():
    logo = Image.new("RGBA", (1200, 1200), (0, 0, 0, 0))
    logo.paste((220, 60, 40, 255), (200, 200, 1000, 1000))
    buf = io.BytesIO()
    logo.save(buf, "PNG")

    out, ext = optimise(buf.getvalue(), "logo")
    assert ext == ".png"
    with Image.open(io.BytesIO(out)) as im:
        assert im.mode == "RGBA"
        assert im.getpixel((5, 5))[3] == 0, "the transparent corner is still transparent"


def test_a_transparent_photo_is_flattened_onto_white():
    """Straight to RGB would turn the transparent area black."""
    shot = Image.new("RGBA", (800, 800), (0, 0, 0, 0))
    shot.paste((10, 120, 90, 255), (100, 100, 700, 700))
    buf = io.BytesIO()
    shot.save(buf, "PNG")

    out, ext = optimise(buf.getvalue(), "player")
    assert ext == ".jpg"
    with Image.open(io.BytesIO(out)) as im:
        assert im.getpixel((3, 3)) == pytest.approx((255, 255, 255), abs=6)


def test_exif_rotation_is_applied():
    """Phones flag orientation instead of rotating the pixels."""
    im = Image.new("RGB", (1200, 600), (200, 30, 30))
    buf = io.BytesIO()
    exif = im.getexif()
    exif[274] = 6  # rotate 90° clockwise on display
    im.save(buf, "JPEG", exif=exif)

    out, _ = optimise(buf.getvalue(), "player")
    with Image.open(io.BytesIO(out)) as result:
        assert result.height > result.width, "the sideways photo was stood upright"


def test_a_file_that_is_not_an_image_is_stored_as_sent():
    junk = b"this is not an image at all"
    out, ext = optimise(junk, "player")
    assert out == junk and ext == "", "better stored as-is than rejected mid-registration"


def test_banners_keep_more_width_than_portraits():
    wide, _ = optimise(jpeg(3000, 1500), "wide")
    with Image.open(io.BytesIO(wide)) as im:
        assert max(im.size) <= 1600
        assert max(im.size) > 900, "a banner runs full width, so it keeps more detail"


def test_upload_folders_map_to_the_right_size():
    """A player portrait shouldn't be stored at banner resolution."""
    from app.routers.content import PROFILE_BY_FOLDER

    assert PROFILE_BY_FOLDER["players"] == "player"
    assert PROFILE_BY_FOLDER["registrations"] == "player"
    assert PROFILE_BY_FOLDER["teams"] == "logo"

    photo = jpeg(3024, 4032)
    as_player, _ = optimise(photo, PROFILE_BY_FOLDER["players"])
    as_banner, _ = optimise(photo, "wide")
    assert len(as_player) < len(as_banner) / 2, "the player profile is meaningfully smaller"
