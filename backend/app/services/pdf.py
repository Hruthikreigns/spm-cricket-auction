"""Registration list as a PDF.

Built with ReportLab's Platypus so the table breaks across pages properly and
the header repeats — the point of this document is that someone prints it and
works down the list at a desk.
"""

import io
import logging
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from ..models import League, Registration, RegistrationStatus

# Print-friendly rather than the on-screen palette: dark ink on white, with
# the amber kept only for rules and headers so it survives a mono printer.
INK = colors.HexColor("#1a1a1a")
MUTED = colors.HexColor("#6b6b6b")
LINE = colors.HexColor("#cfcfcf")
HEADER_BG = colors.HexColor("#1f2d26")
ZEBRA = colors.HexColor("#f4f5f2")

log = logging.getLogger(__name__)

STATUS_LABEL = {
    RegistrationStatus.PENDING: "Pending",
    RegistrationStatus.APPROVED: "Approved",
    RegistrationStatus.REJECTED: "Rejected",
}


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title", parent=base["Title"], fontName="Helvetica-Bold", fontSize=20,
            textColor=INK, alignment=0, spaceAfter=2,
        ),
        "sub": ParagraphStyle(
            "sub", parent=base["Normal"], fontSize=9, textColor=MUTED, spaceAfter=10
        ),
        "cell": ParagraphStyle(
            "cell", parent=base["Normal"], fontSize=8.5, leading=11, textColor=INK
        ),
        "cellMuted": ParagraphStyle(
            "cellMuted", parent=base["Normal"], fontSize=8, leading=10, textColor=MUTED
        ),
        "head": ParagraphStyle(
            "head", parent=base["Normal"], fontSize=8, leading=10,
            textColor=colors.white, fontName="Helvetica-Bold",
        ),
        "note": ParagraphStyle(
            "note", parent=base["Normal"], fontSize=7.5, textColor=MUTED, alignment=TA_RIGHT
        ),
    }


def _thumb(photo_url: str | None, upload_dir: str, db=None) -> Image | Paragraph:
    """A small photo, or a dash when there isn't a usable one.

    Reads from disk rather than over HTTP — the file is already on this
    machine, and generating a document shouldn't depend on the web server
    answering itself.

    The image is decoded with Pillow first and re-encoded into memory. That
    looks like extra work, but ReportLab loads images lazily during build, so
    a truncated or mislabelled upload would otherwise blow up the whole export
    long after this function has returned, with no way to fall back. Someone
    will upload a .jpg that is really a screenshot, or a half-finished
    transfer, and one bad file must not cost the organiser the register.
    """
    style = _styles()["cellMuted"]
    if not photo_url:
        return Paragraph("—", style)

    raw: bytes | None = None
    if db is not None:
        from . import storage

        found = storage.load(db, photo_url)
        if found:
            raw = found[0]
    if raw is None:
        path = Path(upload_dir) / "registrations" / Path(photo_url).name
        if not path.exists():
            return Paragraph("—", style)
        raw = path.read_bytes()

    try:
        from PIL import Image as PILImage

        with PILImage.open(io.BytesIO(raw)) as im:
            im.load()  # force the decode here, where it can be caught
            # Flatten transparency onto white first. Converting straight to RGB
            # fills transparent pixels with black, which turns a PNG portrait
            # into a solid black rectangle on the page.
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGBA")
                flat = PILImage.new("RGB", im.size, (255, 255, 255))
                flat.paste(im, mask=im.split()[-1])
                im = flat
            else:
                im = im.convert("RGB")
            im.thumbnail((240, 320))
            buffer = io.BytesIO()
            im.save(buffer, format="JPEG", quality=70)
        buffer.seek(0)
        thumb = Image(buffer, width=13 * mm, height=17 * mm, kind="proportional")
        thumb.hAlign = "CENTER"
        return thumb
    except Exception as exc:  # noqa: BLE001
        log.warning("skipping unreadable photo %s: %s", photo_url, exc)
        return Paragraph("—", style)


def build_registrations_pdf(
    league: League,
    rows: list[Registration],
    upload_dir: str,
    include_photos: bool = True,
    db=None,
) -> bytes:
    """Render the register. Returns the PDF bytes."""
    s = _styles()
    buffer = io.BytesIO()
    printed = datetime.now().strftime("%d %b %Y, %H:%M")

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
        title=f"{league.name} — registered players",
        author="SPM Cricket Auction",
    )

    story: list = [
        Paragraph(league.name, s["title"]),
        Paragraph(
            " · ".join(
                filter(
                    None,
                    [
                        "Registered players",
                        f"Season {league.season}" if league.season else None,
                        league.venue,
                        f"{len(rows)} entries",
                        f"printed {printed}",
                    ],
                )
            ),
            s["sub"],
        ),
    ]

    headers = ["#", "Photo", "Player", "Mobile", "Email", "Place", "Role", "Jersey", "Status", "Registered"]
    widths = [8 * mm, 16 * mm, 42 * mm, 24 * mm, 52 * mm, 30 * mm, 24 * mm, 14 * mm, 20 * mm, 24 * mm]
    if not include_photos:
        headers.pop(1)
        widths.pop(1)
        widths[2] += 8 * mm

    data = [[Paragraph(h, s["head"]) for h in headers]]

    for index, r in enumerate(rows, start=1):
        cells = [
            Paragraph(str(index), s["cellMuted"]),
            _thumb(r.photo_url, upload_dir, db) if include_photos else None,
            Paragraph(r.name, s["cell"]),
            Paragraph(r.mobile or "—", s["cell"]),
            Paragraph(r.email or "—", s["cellMuted"]),
            Paragraph(r.place or "—", s["cell"]),
            Paragraph(r.role.value.replace("_", " ").title(), s["cellMuted"]),
            Paragraph(str(r.jersey_number) if r.jersey_number is not None else "—", s["cellMuted"]),
            Paragraph(STATUS_LABEL.get(r.status, r.status.value), s["cell"]),
            Paragraph(r.created_at.strftime("%d %b %Y") if r.created_at else "—", s["cellMuted"]),
        ]
        data.append([c for c in cells if c is not None])

    table = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ZEBRA]),
    ]
    table.setStyle(TableStyle(style))
    story.append(table)

    if not rows:
        story.append(Spacer(1, 8 * mm))
        story.append(Paragraph("Nobody has registered yet.", s["cellMuted"]))

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(12 * mm, 8 * mm, f"{league.name} — registered players")
        canvas.drawRightString(
            landscape(A4)[0] - 12 * mm, 8 * mm, f"Page {canvas.getPageNumber()}"
        )
        canvas.restoreState()

    try:
        doc.build(story, onFirstPage=footer, onLaterPages=footer)
    except Exception:  # noqa: BLE001
        if not include_photos:
            raise
        log.exception("registration PDF failed with photos; retrying without them")
        return build_registrations_pdf(league, rows, upload_dir, include_photos=False, db=db)

    return buffer.getvalue()


# --------------------------------------------------------------------------
# The player's own card
# --------------------------------------------------------------------------
def build_registration_card(league: League, r: Registration, upload_dir: str, db=None) -> bytes:
    """A single-page card the player keeps.

    Portrait A5 so it prints two-up on A4 or reads well on a phone. Everything
    on it is the player's own information, which is why the token that fetches
    it unlocks nothing else.
    """
    s = _styles()
    buffer = io.BytesIO()
    page = (148 * mm, 210 * mm)

    doc = SimpleDocTemplate(
        buffer,
        pagesize=page,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=14 * mm,
        bottomMargin=12 * mm,
        title=f"{r.name} — {league.name} registration",
        author="SPM Cricket Auction",
    )

    heading = ParagraphStyle(
        "cardHeading", fontName="Helvetica-Bold", fontSize=22, leading=24, textColor=INK
    )
    label = ParagraphStyle("cardLabel", fontName="Helvetica", fontSize=7.5, textColor=MUTED)
    value = ParagraphStyle("cardValue", fontName="Helvetica-Bold", fontSize=11, textColor=INK)

    story: list = [
        Paragraph(league.name.upper(), s["sub"]),
        Paragraph("Player registration", heading),
        Spacer(1, 6 * mm),
    ]

    # Photo beside the headline details.
    photo = _thumb(r.photo_url, upload_dir, db)
    if isinstance(photo, Image):
        photo.drawWidth = 38 * mm
        photo.drawHeight = 48 * mm

    header = Table(
        [[photo, Paragraph(r.name, ParagraphStyle(
            "cardName", fontName="Helvetica-Bold", fontSize=19, leading=21, textColor=INK
        ))]],
        colWidths=[42 * mm, 82 * mm],
    )
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))
    story += [header, Spacer(1, 6 * mm)]

    rows = [
        ("Registration no.", f"#{r.id:04d}"),
        ("Role", r.role.value.replace("_", " ").title()),
        ("Place", r.place or "—"),
        ("Jersey", str(r.jersey_number) if r.jersey_number is not None else "—"),
        ("Mobile", r.mobile or "—"),
        ("Email", r.email or "—"),
        ("Registered", r.created_at.strftime("%d %b %Y") if r.created_at else "—"),
        ("Status", STATUS_LABEL.get(r.status, r.status.value)),
    ]
    detail = Table(
        [[Paragraph(k, label), Paragraph(v, value)] for k, v in rows],
        colWidths=[34 * mm, 90 * mm],
    )
    detail.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
    ]))
    story += [detail, Spacer(1, 8 * mm)]

    if league.venue or league.auction_date:
        when = league.auction_date.strftime("%d %b %Y") if league.auction_date else "to be announced"
        story.append(
            Paragraph(f"Auction: {when}{f' · {league.venue}' if league.venue else ''}", s["cellMuted"])
        )
        story.append(Spacer(1, 3 * mm))

    story.append(
        Paragraph(
            "Keep this card. Show it at the ground on auction day. Your entry is confirmed by "
            "the organisers before the auction — if anything here is wrong, contact them.",
            s["cellMuted"],
        )
    )

    doc.build(story)
    return buffer.getvalue()
