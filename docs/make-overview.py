"""
PriceLens — three-page business overview, diagram-led.

Regenerate:  python docs/make-overview.py docs/PriceLens-Overview.pdf

Every figure comes from the running system or the codebase:
  · evidence weights          apps/api/src/matching/evidence.mjs  (WEIGHTS)
  · confidence bands          apps/api/src/matching/evidence.mjs  (MATCH_TIERS)
  · shortlist / enrich depth  apps/api/src/matching/matcher.mjs   (MAX_SCAN, MAX_ENRICH)
  · audit results             README.md, "Measured accuracy"
  · worked example + scores   GET /api/products/<id>/report
  · portfolio split           GET /api/export/facets
Update the constants below rather than editing a PDF by hand.

Diagram vocabulary is deliberately varied — funnel, donut, gauge, waffle, cards.
A page of bar charts all read the same; different shapes carry different ideas.
"""
import math
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.fonts import addMapping
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, HRFlowable, KeepTogether, NextPageTemplate,
    PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle,
)

OUT = sys.argv[1] if len(sys.argv) > 1 else "PriceLens-Overview.pdf"

# ── Fonts ─────────────────────────────────────────────────────
# Built-in Helvetica has no rupee glyph — it prints as a solid black box, which
# is fatal on a pricing document. Arial carries it and is metrically the same.
FONT_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
_FACES = [("Helvetica", "arial.ttf", 0, 0), ("Helvetica-Bold", "arialbd.ttf", 1, 0),
          ("Helvetica-Oblique", "ariali.ttf", 0, 1), ("Helvetica-BoldOblique", "arialbi.ttf", 1, 1)]
if not all(os.path.exists(os.path.join(FONT_DIR, f)) for _, f, _, _ in _FACES):
    raise SystemExit("Arial not found — refusing to render, the rupee sign would print as a box.")
for _name, _file, _b, _i in _FACES:
    pdfmetrics.registerFont(TTFont(_name, os.path.join(FONT_DIR, _file)))
    addMapping("Helvetica", _b, _i, _name)

# ── Palette ───────────────────────────────────────────────────
# Navy carries the structure; rose is the single brand accent; the rest appear
# only where colour encodes something — a platform, or money at risk.
NAVY = colors.HexColor("#14304F")
NAVY_MID = colors.HexColor("#3D6187")
NAVY_SOFT = colors.HexColor("#7C9CBB")
NAVY_PALE = colors.HexColor("#DCE6EF")
ROSE = colors.HexColor("#E11D48")
ROSE_PALE = colors.HexColor("#FBE3E9")
CLIQ = NAVY
MYNTRA = colors.HexColor("#C2185B")
AJIO = colors.HexColor("#1E6FBF")
GOOD = colors.HexColor("#0F766E")
BAD = colors.HexColor("#B3261E")
AMBER = colors.HexColor("#B4801F")
INK = colors.HexColor("#111111")
GREY = colors.HexColor("#5A5A5A")
LIGHT = colors.HexColor("#8A8A8A")
RULE = colors.HexColor("#C3CFDA")
HAIR = colors.HexColor("#DFE6ED")
BAND = colors.HexColor("#EDF1F5")
WHITE = colors.white

PAGE_W, PAGE_H = A4
MARGIN_X, MARGIN_T, MARGIN_B = 16 * mm, 15 * mm, 14 * mm

# ── Content constants ─────────────────────────────────────────
# (name, share, short reason) — shares sum to 100.
WEIGHTS = [
    ("List price (MRP)", 24, "Brand-set per style", NAVY),
    ("Specifications", 20, "Compared by meaning", colors.HexColor("#2C5178")),
    ("Product title", 16, "Strong but imitable", NAVY_MID),
    ("Product image", 15, "Text cannot fake it", colors.HexColor("#5C7FA3")),
    ("Manufacturer code", 12, "Decisive, rarely given", NAVY_SOFT),
    ("Description", 8, "Corroborating detail", colors.HexColor("#9FB6CC")),
    ("Brand agreement", 5, "Rewards an exact match", NAVY_PALE),
]
FUNNEL = [(100, "SEARCH", "Several searches per site, pooled"),
          (10, "ELIMINATE", "Contradictions removed, rest ranked"),
          (5, "WEIGH", "Full page and photograph examined"),
          (1, "DECIDE", "Published with reasons — or no match")]

EX_TITLE = "American Eagle — Green Cotton Regular Fit Solid T-Shirt"
EX_PRICES = [("Tata CLIQ", 1779, 1999, 11, CLIQ), ("Myntra", 1779, 1999, 11, MYNTRA),
             ("Ajio", 980, 1999, 51, AJIO)]
EX_OVERALL = 85
EX_CHIPS = ["Brand matches", "Exact MRP match", "Specifications agree 8 of 9",
            "Colour verified from image", "Same garment type"]
EX_ACTION = "Ajio is \u20b9799 cheaper — review pricing or promotion on this SKU."

PORTFOLIO = [("CLIQ is cheapest", 4, GOOD), ("Price parity", 2, NAVY_SOFT),
             ("A rival undercuts CLIQ", 12, BAD), ("No match provable", 5, colors.HexColor("#D6DEE6"))]
AUDIT = [("Round 1", "weighted evidence", 89, 86), ("Round 2", "stricter gates", 94, 73),
         ("Round 3", "current engine", 96, 78)]

# ── Styles ────────────────────────────────────────────────────
body = ParagraphStyle("body", fontName="Helvetica", fontSize=8.6, leading=12.2,
                      textColor=INK, alignment=TA_JUSTIFY)
lead = ParagraphStyle("lead", parent=body, fontSize=9.6, leading=13.6)
h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=10.4, leading=12,
                    textColor=NAVY, spaceAfter=3)
kicker = ParagraphStyle("kicker", fontName="Helvetica-Bold", fontSize=6.6, leading=8,
                        textColor=ROSE, spaceAfter=1.5)
title = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=21, leading=23, textColor=NAVY)
subtitle = ParagraphStyle("subtitle", fontName="Helvetica", fontSize=10, leading=13, textColor=GREY)
card_t = ParagraphStyle("card_t", fontName="Helvetica-Bold", fontSize=8.3, leading=10.2, textColor=NAVY)
card_b = ParagraphStyle("card_b", fontName="Helvetica", fontSize=7.6, leading=9.8, textColor=INK)


def section(text):
    return KeepTogether([
        HRFlowable(width="100%", thickness=0.9, color=NAVY, spaceAfter=3),
        Paragraph(text, h1),
    ])


def wrap_text(text, width, font, size):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if pdfmetrics.stringWidth(trial, font, size) <= width:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def inr(v):
    return "\u20b9" + f"{v:,}"


# Tick, cross and arrow are DRAWN, not typed. Arial has no glyph for U+2713 /
# U+2715 / U+2193, and a missing glyph prints as a hollow box — which on a
# document about correctness looks like a defect. Vector marks always render.
def mark_check(c, x, y, s, col, w=1.4):
    c.setStrokeColor(col)
    c.setLineWidth(w)
    c.setLineCap(1)
    p = c.beginPath()
    p.moveTo(x, y + 0.45 * s)
    p.lineTo(x + 0.38 * s, y + 0.05 * s)
    p.lineTo(x + s, y + 0.95 * s)
    c.drawPath(p, stroke=1, fill=0)


def mark_cross(c, x, y, s, col, w=1.4):
    c.setStrokeColor(col)
    c.setLineWidth(w)
    c.setLineCap(1)
    c.line(x, y, x + s, y + s)
    c.line(x, y + s, x + s, y)


def mark_arrow_down(c, x, y, s, col):
    c.setFillColor(col)
    p = c.beginPath()
    p.moveTo(x, y)
    p.lineTo(x + s, y)
    p.lineTo(x + s / 2, y - s * 0.9)
    p.close()
    c.drawPath(p, stroke=0, fill=1)


def donut(c, cx, cy, r_out, r_in, parts, start=90):
    """Filled ring: wedges to r_out, then the hole punched back out in white."""
    ang = start
    for _name, share, _reason, hue in parts:
        extent = -360.0 * share / 100.0
        c.setFillColor(hue)
        c.setStrokeColor(WHITE)
        c.setLineWidth(1.1)
        c.wedge(cx - r_out, cy - r_out, cx + r_out, cy + r_out, ang, extent, stroke=1, fill=1)
        ang += extent
    c.setFillColor(WHITE)
    c.setStrokeColor(WHITE)
    c.circle(cx, cy, r_in, stroke=0, fill=1)


# ── Diagrams ──────────────────────────────────────────────────
class FunnelStages(Flowable):
    """A true narrowing funnel: each tier is a stage, its width the survivors."""

    def __init__(self, width):
        super().__init__()
        self.width = width
        self.tier_h = 17 * mm
        self.height = self.tier_h * len(FUNNEL) + 6 * mm

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        text_x = self.width * 0.46
        span = self.width * 0.42          # widest tier
        cx = span / 2 + 2 * mm
        biggest = FUNNEL[0][0]
        shades = [NAVY_PALE, NAVY_SOFT, NAVY_MID, NAVY]

        def half(count):
            # Square root keeps a single survivor visible beside a hundred.
            return max(7 * mm, span * (count / biggest) ** 0.5) / 2

        top = self.height - 3 * mm
        for i, (count, stage, note) in enumerate(FUNNEL):
            y_top = top - i * self.tier_h
            y_bot = y_top - self.tier_h + 2 * mm
            w_top = half(count)
            w_bot = half(FUNNEL[i + 1][0]) if i + 1 < len(FUNNEL) else half(count) * 0.82

            p = c.beginPath()
            p.moveTo(cx - w_top, y_top)
            p.lineTo(cx + w_top, y_top)
            p.lineTo(cx + w_bot, y_bot)
            p.lineTo(cx - w_bot, y_bot)
            p.close()
            c.setFillColor(shades[i])
            c.setStrokeColor(WHITE)
            c.setLineWidth(1.4)
            c.drawPath(p, stroke=1, fill=1)

            c.setFillColor(WHITE if i >= 2 else NAVY)
            c.setFont("Helvetica-Bold", 12)
            c.drawCentredString(cx, (y_top + y_bot) / 2 - 2, str(count))

            # Stage caption, on a rule that ties it to its tier.
            my = (y_top + y_bot) / 2
            c.setStrokeColor(HAIR)
            c.setLineWidth(0.5)
            c.line(cx + w_top + 2 * mm, my, text_x - 2 * mm, my)
            c.setFillColor(ROSE)
            c.setFont("Helvetica-Bold", 7)
            c.drawString(text_x, my + 1.6 * mm, f"{i + 1}")
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 9)
            c.drawString(text_x + 4 * mm, my + 1.4 * mm, stage)
            c.setFillColor(GREY)
            c.setFont("Helvetica", 7.6)
            c.drawString(text_x + 4 * mm, my - 3 * mm, note)

        c.setFillColor(LIGHT)
        c.setFont("Helvetica-Oblique", 6.8)
        c.drawString(0, 0, "Candidates surviving each stage — one live comparison, one competitor site")


class JudgementDiagram(Flowable):
    """Left: three gates that only reject. Right: signals pooling into one score."""

    GATES = [("BRAND", "different label"), ("CUSTOMER", "men's vs women's"),
             ("TYPE", "polo vs t-shirt")]
    CHIPS = ["MRP", "SPECS", "TITLE", "IMAGE", "CODE", "DESC", "BRAND"]

    def __init__(self, width):
        super().__init__()
        self.width = width
        self.height = 70 * mm

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        half_w = self.width / 2 - 4 * mm
        right_x = self.width / 2 + 4 * mm
        top = self.height

        for hx, head, sub, hue in ((0, "ELIMINATION", "only ever rejects", NAVY),
                                   (right_x, "EVIDENCE", "never decides alone", ROSE)):
            c.setStrokeColor(RULE)
            c.setLineWidth(0.6)
            c.rect(hx, 0, half_w, top, stroke=1, fill=0)
            c.setFillColor(hue)
            c.rect(hx, top - 6.4 * mm, half_w, 6.4 * mm, stroke=0, fill=1)
            c.setFillColor(WHITE)
            c.setFont("Helvetica-Bold", 8.2)
            c.drawString(hx + 3 * mm, top - 4.4 * mm, head)
            c.setFont("Helvetica", 7.2)
            c.drawRightString(hx + half_w - 3 * mm, top - 4.4 * mm, sub)

        # Left: a lane of candidates meeting three gates in turn.
        gx = 4 * mm
        lane_y = top - 24 * mm
        lane_w = half_w - 8 * mm
        c.setFillColor(BAND)
        c.rect(gx, lane_y, lane_w, 9 * mm, stroke=0, fill=1)
        c.setFillColor(NAVY_SOFT)
        c.setFont("Helvetica-Bold", 6.2)
        c.drawString(gx, lane_y + 11.5 * mm, "CANDIDATES")
        for i in range(4):
            c.setFillColor(NAVY_SOFT)
            c.rect(gx + 1.6 * mm + i * 4 * mm, lane_y + 2.6 * mm, 3 * mm, 3.8 * mm, stroke=0, fill=1)

        step = (lane_w - 31 * mm) / len(self.GATES)
        for i, (name, why) in enumerate(self.GATES):
            x = gx + 28 * mm + i * step
            c.setStrokeColor(NAVY)
            c.setLineWidth(1.4)
            c.line(x, lane_y - 1.5 * mm, x, lane_y + 10.5 * mm)
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 6.2)
            c.drawCentredString(x, lane_y + 11.5 * mm, name)
            mark_cross(c, x - 5.4 * mm, lane_y - 7.4 * mm, 3 * mm, BAD)
            c.setFillColor(BAD)
            c.setFont("Helvetica", 5.8)
            c.drawCentredString(x - 3.9 * mm, lane_y - 11.6 * mm, why)

        mark_check(c, gx + lane_w - 5.4 * mm, lane_y + 2.6 * mm, 4 * mm, GOOD, 1.8)
        c.setFillColor(GOOD)
        c.setFont("Helvetica-Bold", 6.2)
        c.drawCentredString(gx + lane_w - 3.4 * mm, lane_y + 11.5 * mm, "PASS")

        c.setFillColor(GREY)
        c.setFont("Helvetica", 7.2)
        for k, line in enumerate(wrap_text(
                "Only a contradiction eliminates. A missing attribute is not a contradiction — one "
                "marketplace publishes far less detail, and penalising it for that would invent "
                "mismatches that do not exist.", lane_w, "Helvetica", 7.2)):
            c.drawString(gx, lane_y - 20 * mm - k * 9.4, line)

        # Right: seven signals converging on a single figure.
        bx = right_x + 4 * mm
        inner = half_w - 8 * mm
        by = top - 14 * mm
        chip_w = (inner - 3 * 2 * mm) / 4
        for i, label in enumerate(self.CHIPS):
            col, row = i % 4, i // 4
            x = bx + col * (chip_w + 2 * mm)
            y = by - row * 7.4 * mm
            hue = WEIGHTS[i][3]
            c.setFillColor(hue)
            c.setStrokeColor(WHITE)
            c.setLineWidth(0.8)
            c.rect(x, y, chip_w, 5.8 * mm, stroke=1, fill=1)
            c.setFillColor(WHITE if WEIGHTS[i][1] >= 12 else NAVY)
            c.setFont("Helvetica-Bold", 6.2)
            c.drawCentredString(x + chip_w / 2, y + 2 * mm, label)

        mark_arrow_down(c, bx + inner / 2 - 2 * mm, by - 11 * mm, 4 * mm, ROSE)
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 7.4)
        c.drawCentredString(bx + inner / 2, by - 18.5 * mm, "combined  ·  weighted  ·  renormalised")
        c.setFillColor(NAVY)
        c.rect(bx, by - 28 * mm, inner, 7.4 * mm, stroke=0, fill=1)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 8.2)
        c.drawCentredString(bx + inner / 2, by - 25.6 * mm, "ONE CONFIDENCE FIGURE")
        c.setFillColor(GREY)
        c.setFont("Helvetica", 7.2)
        for k, line in enumerate(wrap_text(
                "Agreement across several independent signals outranks perfect agreement on one — "
                "which lets a genuine match survive a retailer revising its list price, and stops a "
                "coincidence passing on a similar title alone.", inner, "Helvetica", 7.2)):
            c.drawString(bx, by - 34 * mm - k * 9.4, line)


class WeightDonut(Flowable):
    """The seven signals as one ring, with a keyed legend."""

    def __init__(self, width):
        super().__init__()
        self.width = width
        self.height = 74 * mm

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        r_out = 32 * mm
        cx, cy = r_out + 4 * mm, self.height / 2
        donut(c, cx, cy, r_out, r_out * 0.56, WEIGHTS)

        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 13)
        c.drawCentredString(cx, cy + 1 * mm, "100%")
        c.setFillColor(GREY)
        c.setFont("Helvetica", 6.4)
        c.drawCentredString(cx, cy - 3.4 * mm, "of one score")

        lx = cx + r_out + 11 * mm
        ly = self.height - 6 * mm
        for name, share, reason, hue in WEIGHTS:
            c.setFillColor(hue)
            c.setStrokeColor(NAVY_SOFT)
            c.setLineWidth(0.4)
            c.rect(lx, ly - 3.4 * mm, 3.6 * mm, 3.6 * mm, stroke=1, fill=1)
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 8.4)
            c.drawString(lx + 5.4 * mm, ly - 3 * mm, f"{share}%")
            c.setFillColor(INK)
            c.setFont("Helvetica-Bold", 8)
            c.drawString(lx + 14 * mm, ly - 3 * mm, name)
            c.setFillColor(GREY)
            c.setFont("Helvetica", 7.4)
            c.drawString(lx + 47 * mm, ly - 3 * mm, reason)
            ly -= 9.4 * mm


class RenormalisePair(Flowable):
    """Two rings, before and after a signal disappears."""

    THIN = [("List price (MRP)", 33, "", NAVY), ("Product title", 22, "", NAVY_MID),
            ("Product image", 21, "", colors.HexColor("#5C7FA3")),
            ("Manufacturer code", 17, "", NAVY_SOFT), ("Brand agreement", 7, "", NAVY_PALE)]

    def __init__(self, width):
        super().__init__()
        self.width = width
        self.height = 60 * mm

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        r = 21 * mm
        cy = self.height - r - 3 * mm
        left_cx = self.width * 0.17
        right_cx = self.width * 0.62

        donut(c, left_cx, cy, r, r * 0.55, WEIGHTS)
        donut(c, right_cx, cy, r, r * 0.55, self.THIN)
        for cx, cap, sub in ((left_cx, "All seven signals", "full product page"),
                             (right_cx, "Five signals", "no product page published")):
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 7.8)
            c.drawCentredString(cx, cy - r - 5 * mm, cap)
            c.setFillColor(GREY)
            c.setFont("Helvetica", 7)
            c.drawCentredString(cx, cy - r - 9 * mm, sub)

        # Arrow between the two rings
        ax0, ax1 = left_cx + r + 4 * mm, right_cx - r - 4 * mm
        c.setStrokeColor(ROSE)
        c.setLineWidth(1.2)
        c.line(ax0, cy, ax1 - 2 * mm, cy)
        p = c.beginPath()
        p.moveTo(ax1, cy)
        p.lineTo(ax1 - 2.6 * mm, cy + 1.6 * mm)
        p.lineTo(ax1 - 2.6 * mm, cy - 1.6 * mm)
        p.close()
        c.setFillColor(ROSE)
        c.drawPath(p, stroke=0, fill=1)
        c.setFillColor(ROSE)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString((ax0 + ax1) / 2, cy + 2.6 * mm, "SHARES REBALANCE")

        tx = right_cx + r + 7 * mm
        c.setFillColor(INK)
        c.setFont("Helvetica", 7.6)
        for k, line in enumerate(wrap_text(
                "Missing signals are removed, never scored as zero. MRP rises from 24% to 33% of the "
                "decision, so a marketplace with a thin listing is judged on what it does show.",
                self.width - tx, "Helvetica", 7.6)):
            c.drawString(tx, cy + 6 * mm - k * 10, line)


class ConfidenceGauge(Flowable):
    """A half-dial: the reporting bands, with the worked example's needle on it."""

    def __init__(self, width, value=EX_OVERALL):
        super().__init__()
        self.width = width
        self.value = value
        self.height = 58 * mm

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        cx, cy = self.width * 0.30, 20 * mm
        r_out, r_in = 33 * mm, 20 * mm
        segs = [(0, 58, colors.HexColor("#E7ECF1"), "NOT REPORTED"),
                (58, 72, NAVY_SOFT, "PARTIAL"), (72, 85, NAVY_MID, "CLOSE"), (85, 100, NAVY, "EXACT")]

        for lo, hi, hue, _lab in segs:
            c.setFillColor(hue)
            c.setStrokeColor(WHITE)
            c.setLineWidth(1.2)
            c.wedge(cx - r_out, cy - r_out, cx + r_out, cy + r_out,
                    180 - 180.0 * lo / 100, -180.0 * (hi - lo) / 100, stroke=1, fill=1)
        c.setFillColor(WHITE)
        c.setStrokeColor(WHITE)
        c.wedge(cx - r_in, cy - r_in, cx + r_in, cy + r_in, 180, -180, stroke=0, fill=1)

        # Tick labels around the arc
        c.setFont("Helvetica-Bold", 6.6)
        c.setFillColor(NAVY)
        for v in (0, 58, 72, 85, 100):
            a = math.radians(180 - 180.0 * v / 100)
            c.drawCentredString(cx + (r_out + 3.4 * mm) * math.cos(a),
                                cy + (r_out + 2.2 * mm) * math.sin(a), f"{v}")

        # Needle
        a = math.radians(180 - 180.0 * self.value / 100)
        c.setStrokeColor(ROSE)
        c.setLineWidth(1.8)
        c.line(cx, cy, cx + (r_out - 2 * mm) * math.cos(a), cy + (r_out - 2 * mm) * math.sin(a))
        c.setFillColor(ROSE)
        c.circle(cx, cy, 1.8 * mm, stroke=0, fill=1)
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 13)
        c.drawCentredString(cx, cy - 8 * mm, f"{self.value}%")
        c.setFillColor(GREY)
        c.setFont("Helvetica", 6.6)
        c.drawCentredString(cx, cy - 12 * mm, "the worked example")

        tx = cx + r_out + 12 * mm
        ty = self.height - 10 * mm
        for lo, hi, hue, lab in reversed(segs):
            c.setFillColor(hue)
            c.setStrokeColor(NAVY_SOFT)
            c.setLineWidth(0.4)
            c.rect(tx, ty - 3.4 * mm, 3.6 * mm, 3.6 * mm, stroke=1, fill=1)
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 7.6)
            c.drawString(tx + 5.4 * mm, ty - 3 * mm, lab)
            c.setFillColor(GREY)
            c.setFont("Helvetica", 7.4)
            c.drawString(tx + 30 * mm, ty - 3 * mm, f"{lo}–{hi}%" if lo else f"below {hi}%")
            ty -= 7.4 * mm
        c.setFillColor(GREY)
        c.setFont("Helvetica", 7.4)
        for k, line in enumerate(wrap_text(
                "Below 58% nothing is reported as a match. Every published match carries its band "
                "and the reasons behind it.", self.width - tx, "Helvetica", 7.4)):
            c.drawString(tx, ty - 1 * mm - k * 9.6, line)


class PriceCards(Flowable):
    """Three price tags, and the gap between the cheapest and Tata CLIQ."""

    def __init__(self, width):
        super().__init__()
        self.width = width
        self.height = 47 * mm

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        n = len(EX_PRICES)
        gap = 5 * mm
        cw = (self.width - gap * (n - 1)) / n
        ch = 30 * mm
        top = self.height - 6 * mm
        cheapest = min(p for _, p, _, _, _ in EX_PRICES)

        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(0, top + 2 * mm, EX_TITLE)

        for i, (name, price, mrp, disc, hue) in enumerate(EX_PRICES):
            x = i * (cw + gap)
            y = top - ch
            c.setStrokeColor(RULE)
            c.setLineWidth(0.6)
            c.setFillColor(WHITE)
            c.rect(x, y, cw, ch, stroke=1, fill=1)
            c.setFillColor(hue)
            c.rect(x, y + ch - 7 * mm, cw, 7 * mm, stroke=0, fill=1)
            c.setFillColor(WHITE)
            c.setFont("Helvetica-Bold", 8.6)
            c.drawString(x + 3 * mm, y + ch - 4.8 * mm, name)
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 17)
            c.drawString(x + 3 * mm, y + ch - 17 * mm, inr(price))
            c.setFillColor(GREY)
            c.setFont("Helvetica", 7.4)
            c.drawString(x + 3 * mm, y + ch - 22 * mm, f"MRP {inr(mrp)}")
            c.setFillColor(BAD if price == cheapest else NAVY_SOFT)
            c.setFont("Helvetica-Bold", 7.4)
            c.drawString(x + 3 * mm, y + ch - 26.5 * mm, f"{disc}% off")
            if price == cheapest:
                c.setFillColor(BAD)
                c.rect(x + cw - 17 * mm, y + 2.4 * mm, 14.6 * mm, 4.6 * mm, stroke=0, fill=1)
                c.setFillColor(WHITE)
                c.setFont("Helvetica-Bold", 6.4)
                c.drawCentredString(x + cw - 9.7 * mm, y + 3.9 * mm, "CHEAPEST")

        # The finding, as a banner under the cards
        by = top - ch - 10 * mm
        # Two lines, not one: the finding and the action are different thoughts,
        # and on one line the sentence ran off the right edge of the page.
        gapv = EX_PRICES[0][1] - cheapest
        c.setFillColor(ROSE_PALE)
        c.rect(0, by - 4 * mm, self.width, 13 * mm, stroke=0, fill=1)
        c.setFillColor(BAD)
        c.rect(0, by - 4 * mm, 1.6 * mm, 13 * mm, stroke=0, fill=1)
        c.setFillColor(BAD)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(4.5 * mm, by + 4.4 * mm,
                     f"Ajio undercuts Tata CLIQ by {inr(gapv)} — "
                     f"{round(gapv / EX_PRICES[0][1] * 100)}% of the CLIQ price")
        c.setFillColor(NAVY)
        c.setFont("Helvetica", 8)
        c.drawString(4.5 * mm, by - 1 * mm, f"Recommendation:  {EX_ACTION}")


class EvidenceChips(Flowable):
    """Why the engine called it the same product — the reasons, as chips."""

    def __init__(self, width):
        super().__init__()
        self.width = width
        self.height = 16 * mm

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(ROSE)
        c.setFont("Helvetica-Bold", 6.6)
        c.drawString(0, self.height - 4 * mm, "WHY IT WAS CALLED THE SAME PRODUCT")
        x, y = 0, self.height - 12 * mm
        for label in EX_CHIPS:
            w = pdfmetrics.stringWidth(label, "Helvetica-Bold", 7.2) + 8 * mm
            if x + w > self.width:
                break
            c.setFillColor(BAND)
            c.setStrokeColor(NAVY_SOFT)
            c.setLineWidth(0.5)
            c.roundRect(x, y, w, 6 * mm, 3 * mm, stroke=1, fill=1)
            mark_check(c, x + 2.8 * mm, y + 1.7 * mm, 2.6 * mm, GOOD, 1.2)
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 7.2)
            c.drawString(x + 6.4 * mm, y + 1.8 * mm, label)
            x += w + 2.4 * mm


class Waffle(Flowable):
    """One square per product compared — the portfolio at a glance."""

    def __init__(self, width, cols=12):
        super().__init__()
        self.width = width
        self.cols = cols
        self.height = 46 * mm

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        total = sum(n for _, n, _ in PORTFOLIO)
        cell = 9 * mm
        pad = 1.8 * mm
        cols = min(self.cols, int(self.width // (cell + pad)))
        squares = []
        for name, n, hue in PORTFOLIO:
            squares += [hue] * n

        top = self.height - 4 * mm
        for i, hue in enumerate(squares):
            col, row = i % cols, i // cols
            x = col * (cell + pad)
            y = top - cell - row * (cell + pad)
            c.setFillColor(hue)
            c.setStrokeColor(WHITE)
            c.setLineWidth(0.8)
            c.rect(x, y, cell, cell, stroke=1, fill=1)

        rows = (len(squares) + cols - 1) // cols
        ly = top - rows * (cell + pad) - 5 * mm
        lx = 0
        c.setFont("Helvetica", 7.4)
        for name, n, hue in PORTFOLIO:
            c.setFillColor(hue)
            c.setStrokeColor(NAVY_SOFT)
            c.setLineWidth(0.4)
            c.rect(lx, ly, 3.4 * mm, 3.4 * mm, stroke=1, fill=1)
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 7.6)
            c.drawString(lx + 4.6 * mm, ly + 0.6 * mm, str(n))
            c.setFillColor(INK)
            c.setFont("Helvetica", 7.4)
            c.drawString(lx + 9 * mm, ly + 0.6 * mm, name)
            lx += 9 * mm + c.stringWidth(name, "Helvetica", 7.4) + 8 * mm
        c.setFillColor(GREY)
        c.setFont("Helvetica-Oblique", 7.2)
        c.drawString(0, ly - 6 * mm,
                     f"Each square is one product. {total} compared so far; the {PORTFOLIO[2][1]} in red "
                     "are the working list and export as their own sheet.")


class RoundsProgress(Flowable):
    """Three audit rounds as connected dials, not another bar chart."""

    def __init__(self, width):
        super().__init__()
        self.width = width
        self.height = 50 * mm

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        n = len(AUDIT)
        step = self.width / n
        r = 13 * mm
        cy = self.height - r - 4 * mm

        for i, (label, sub, prec, rec) in enumerate(AUDIT):
            cx = step * (i + 0.5)
            # Ring showing precision as a filled arc.
            c.setFillColor(NAVY_PALE)
            c.setStrokeColor(NAVY_PALE)
            c.circle(cx, cy, r, stroke=0, fill=1)
            c.setFillColor(NAVY if i == n - 1 else NAVY_MID)
            c.setStrokeColor(WHITE)
            c.setLineWidth(0)
            c.wedge(cx - r, cy - r, cx + r, cy + r, 90, -360.0 * prec / 100, stroke=0, fill=1)
            c.setFillColor(WHITE)
            c.circle(cx, cy, r * 0.62, stroke=0, fill=1)
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 12)
            c.drawCentredString(cx, cy - 1.4 * mm, f"{prec}%")

            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 8)
            c.drawCentredString(cx, cy - r - 5 * mm, label)
            c.setFillColor(GREY)
            c.setFont("Helvetica", 7.2)
            c.drawCentredString(cx, cy - r - 9 * mm, sub)
            c.setFillColor(LIGHT)
            c.setFont("Helvetica", 7)
            c.drawCentredString(cx, cy - r - 13.4 * mm, f"recall {rec}%")

            if i < n - 1:
                x0, x1 = cx + r + 2 * mm, step * (i + 1.5) - r - 2 * mm
                c.setStrokeColor(ROSE)
                c.setLineWidth(1)
                c.line(x0, cy, x1 - 2 * mm, cy)
                p = c.beginPath()
                p.moveTo(x1, cy)
                p.lineTo(x1 - 2.4 * mm, cy + 1.4 * mm)
                p.lineTo(x1 - 2.4 * mm, cy - 1.4 * mm)
                p.close()
                c.setFillColor(ROSE)
                c.drawPath(p, stroke=0, fill=1)

        c.setFillColor(GREY)
        c.setFont("Helvetica-Oblique", 7.2)
        c.drawCentredString(self.width / 2, 0,
                            "Ring shows precision — the share of reported matches that are genuinely "
                            "the same product. 110 fresh products, 220 decisions, graded each round.")


class StatStrip(Flowable):
    ITEMS = [("96%", "match precision,\nindependently audited"),
             ("220", "graded decisions\nper audit round"),
             ("7", "independent signals\nbehind every score"),
             ("3", "marketplaces compared\nproduct by product")]

    def __init__(self, width):
        super().__init__()
        self.width = width
        self.height = 20 * mm

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        cw = self.width / len(self.ITEMS)
        c.setFillColor(BAND)
        c.rect(0, 0, self.width, self.height, stroke=0, fill=1)
        c.setStrokeColor(NAVY)
        c.setLineWidth(0.9)
        c.line(0, self.height, self.width, self.height)
        c.line(0, 0, self.width, 0)
        for i, (big, small) in enumerate(self.ITEMS):
            x = i * cw
            if i:
                c.setStrokeColor(RULE)
                c.setLineWidth(0.5)
                c.line(x, 1.5 * mm, x, self.height - 1.5 * mm)
            c.setFillColor(ROSE if i == 0 else NAVY)
            c.setFont("Helvetica-Bold", 16)
            c.drawString(x + 3.5 * mm, self.height - 8.4 * mm, big)
            c.setFont("Helvetica", 6.8)
            c.setFillColor(GREY)
            for k, line in enumerate(small.split("\n")):
                c.drawString(x + 3.5 * mm, self.height - 12.4 * mm - k * 7.6, line)


def cards(items, width, cols=3):
    rows, row = [], []
    for head, text in items:
        inner = Table([[Paragraph(head, card_t)], [Paragraph(text, card_b)]],
                      colWidths=[width / cols - 7 * mm])
        inner.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (0, 0), 0), ("BOTTOMPADDING", (0, 0), (0, 0), 2),
            ("TOPPADDING", (0, 1), (0, 1), 0), ("BOTTOMPADDING", (0, 1), (0, 1), 0),
        ]))
        row.append(inner)
        if len(row) == cols:
            rows.append(row)
            row = []
    if row:
        row += [""] * (cols - len(row))
        rows.append(row)
    t = Table(rows, colWidths=[width / cols] * cols)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3.5 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 3.5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
        ("BOX", (0, 0), (-1, -1), 0.9, NAVY),
    ]))
    return t


TOTAL_PAGES = 3


def chrome(canvas, doc):
    canvas.saveState()
    page = canvas.getPageNumber()
    if page > 1:
        canvas.setFont("Helvetica-Bold", 7)
        canvas.setFillColor(ROSE)
        canvas.drawString(MARGIN_X, PAGE_H - 10 * mm, "PRICELENS")
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(GREY)
        canvas.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 10 * mm,
                               "Competitive Price Intelligence for Tata CLIQ")
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN_X, PAGE_H - 12 * mm, PAGE_W - MARGIN_X, PAGE_H - 12 * mm)
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN_X, MARGIN_B - 3 * mm, PAGE_W - MARGIN_X, MARGIN_B - 3 * mm)
    canvas.setFont("Helvetica", 6.8)
    canvas.setFillColor(LIGHT)
    canvas.drawString(MARGIN_X, MARGIN_B - 6.6 * mm, "PriceLens  ·  Product overview  ·  Confidential")
    canvas.drawRightString(PAGE_W - MARGIN_X, MARGIN_B - 6.6 * mm, f"Page {page} of {TOTAL_PAGES}")
    canvas.restoreState()


doc = BaseDocTemplate(
    OUT, pagesize=A4,
    leftMargin=MARGIN_X, rightMargin=MARGIN_X, topMargin=MARGIN_T, bottomMargin=MARGIN_B,
    title="PriceLens - Competitive Price Intelligence for Tata CLIQ",
    author="PriceLens", subject="Product overview",
)
FW = doc.width
doc.addPageTemplates([
    PageTemplate(id="first",
                 frames=[Frame(MARGIN_X, MARGIN_B, FW, PAGE_H - MARGIN_T - MARGIN_B,
                               leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)],
                 onPage=chrome),
    PageTemplate(id="rest",
                 frames=[Frame(MARGIN_X, MARGIN_B, FW, PAGE_H - (MARGIN_T + 5 * mm) - MARGIN_B,
                               leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)],
                 onPage=chrome),
])

S = []

# ═══════════════════════ PAGE 1 ═══════════════════════
S.append(Paragraph("PRODUCT OVERVIEW", kicker))
S.append(Paragraph("PriceLens", title))
S.append(Spacer(1, 2))
S.append(Paragraph("Competitive price intelligence for Tata CLIQ &#8212; product by product, against "
                   "Myntra and Ajio.", subtitle))
S.append(Spacer(1, 5))
S.append(HRFlowable(width="100%", thickness=1.6, color=ROSE, spaceAfter=7))
S.append(Paragraph(
    "One commercial question, answered at the level a buying decision is made: <b>for this exact "
    "product, what do our competitors charge?</b> Give PriceLens a Tata CLIQ product and it finds the "
    "same item on Myntra and Ajio, then reports both prices, the size of the gap and what to do about "
    "it &#8212; or says plainly that the same item could not be proven.", lead))
S.append(Spacer(1, 7))
S.append(StatStrip(FW))
S.append(Spacer(1, 8))

S.append(section("How one comparison is decided"))
S.append(Paragraph("Four stages. The first three narrow the field; the last commits only when the "
                   "evidence supports it.", body))
S.append(Spacer(1, 3))
S.append(FunnelStages(FW))
S.append(Spacer(1, 7))

S.append(section("Two kinds of judgement, doing different jobs"))
S.append(Spacer(1, 2))
S.append(JudgementDiagram(FW))

# ═══════════════════════ PAGE 2 ═══════════════════════
S.append(NextPageTemplate("rest"))
S.append(PageBreak())

S.append(section("How the weightings were set"))
S.append(Paragraph("Each signal takes a share of the score in proportion to how strongly it identifies "
                   "<i>one specific product</i> rather than a similar one. The shares were set on that "
                   "principle and corrected against measured results over three audit rounds.", body))
S.append(Spacer(1, 3))
S.append(WeightDonut(FW))
S.append(Spacer(1, 6))

S.append(section("When a marketplace publishes less"))
S.append(Spacer(1, 2))
S.append(RenormalisePair(FW))
S.append(Spacer(1, 6))

S.append(section("How confidence is reported"))
S.append(Spacer(1, 2))
S.append(ConfidenceGauge(FW))

# ═══════════════════════ PAGE 3 ═══════════════════════
S.append(PageBreak())

S.append(section("One comparison, end to end"))
S.append(Spacer(1, 2))
S.append(PriceCards(FW))
S.append(Spacer(1, 6))
S.append(EvidenceChips(FW))
S.append(Spacer(1, 5))

S.append(section("The same question, across the portfolio"))
S.append(Spacer(1, 2))
S.append(Waffle(FW))
S.append(Spacer(1, 5))

S.append(section("Accuracy is measured, not asserted"))
S.append(Spacer(1, 2))
S.append(RoundsProgress(FW))
S.append(Spacer(1, 5))

S.append(section("What the software provides"))
S.append(cards([
    ("Any product, on demand",
     "Work from the catalogue or paste any Tata CLIQ link &#8212; uncatalogued products are fetched and "
     "compared live."),
    ("A full comparison report",
     "Pricing, specifications, listing quality and similarity, every verdict explained, with links to "
     "verify. Prints to one page."),
    ("Excel export for analysis",
     "Filter by category, gender, brand or position, then export a summary, a comparison sheet and an "
     "action list."),
    ("Portfolio dashboards",
     "Where CLIQ holds the best price and where it is undercut, with the largest gaps ranked first."),
    ("Saved and reused",
     "A comparison is replayed for seven days rather than re-gathered, always labelled with its age."),
    ("Extends without rebuild",
     "Category knowledge is editable configuration &#8212; adding footwear or bags is a data change."),
], FW, cols=3))

doc.build(S)
print("written:", OUT)
