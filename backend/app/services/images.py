"""Shrink images on the way in.

A modern phone photo is around 8MB at 3024x4032. Four hundred of those is
3GB of disk and 150MB down the wire for a single page of twenty players —
on ground wifi, on auction night. None of that resolution reaches the screen:
the largest a player photo is ever drawn is a few hundred pixels.

So every upload is decoded, resized to something the page actually uses, and
re-encoded once, at the moment it arrives. The original is never kept, because
keeping it would mean paying for it every month and never reading it.
"""

import io
import logging

logger = logging.getLogger(__name__)

# Longest edge, in pixels, per kind of image.
PROFILES: dict[str, tuple[int, int]] = {
    # Portraits fill roughly a third of the block card on a large screen.
    "player": (900, 82),
    # Logos are drawn at 40px, but stay crisp for retina and for print.
    "logo": (600, 85),
    # Banners and posters run full width.
    "wide": (1600, 82),
}


def optimise(blob: bytes, profile: str = "player") -> tuple[bytes, str]:
    """Return (bytes, extension) — resized, re-encoded, stripped of metadata.

    Falls back to the original bytes if anything goes wrong: a photo that
    can't be processed is better stored as-is than rejected, since the player
    is standing there waiting for the form to submit.
    """
    max_edge, quality = PROFILES.get(profile, PROFILES["player"])

    try:
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(blob)) as im:
            im.load()

            # Phones record orientation in EXIF rather than rotating pixels;
            # without this, portraits arrive on their side.
            im = ImageOps.exif_transpose(im)

            has_alpha = im.mode in ("RGBA", "LA", "P")
            if has_alpha:
                # Keep transparency for logos, flatten it for photos — a
                # transparent PNG converted straight to RGB goes black.
                im = im.convert("RGBA")
                if profile != "logo":
                    flat = Image.new("RGB", im.size, (255, 255, 255))
                    flat.paste(im, mask=im.split()[-1])
                    im = flat
                    has_alpha = False
            else:
                im = im.convert("RGB")

            if max(im.size) > max_edge:
                im.thumbnail((max_edge, max_edge), Image.LANCZOS)

            out = io.BytesIO()
            if has_alpha:
                im.save(out, "PNG", optimize=True)
                return out.getvalue(), ".png"

            # progressive so it paints top-down on a slow connection
            im.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
            return out.getvalue(), ".jpg"

    except Exception as exc:  # noqa: BLE001
        logger.warning("could not optimise an upload, storing it as sent: %s", exc)
        return blob, ""
