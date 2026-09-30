"""Cut Stu's flat pose art into a cut-out puppet rig for <stu-avatar>.

Reads the original pose images (left untouched) and writes separate layers to
static/stu-avatar/assets/rig/, all on the same 690x750 canvas as the source so
they stack with no offsets. Draw order in stu-avatar.js, back to front:

    leg-l, leg-r          legs from under the shorts down into the shoe
    shoe-l, shoe-r        shoes (the joint with the leg hides under the collar)
    shoulders             shirt texture continued under the sleeves - only
                          seen when a sleeve swings away from the body
    arm-l, arm-r          sleeve + hanging arm (from stu-idle)
    arm-l-out, arm-r-out  sleeve + open-handed arm held out (from stu-open)
    torso                 shirt + shorts, without sleeves, arms, legs, head
    head                  head, cap and tassel, with the eyebrows painted out
    brow-l, brow-r        eyebrows, so they can rise, drop and tilt per emotion

Face overlays, positioned like the existing mouth and eyelid images:

    eyes-lid-20/35/50/65.png   upper eyelids part-closed (20% to 65%), for
                               happy, soft, droopy or narrowed eyes
    mouth-flat.png             a closed, flat mouth (from stu-think) for sad,
                               serious or thoughtful moments between words

"l"/"r" are screen left/right. Each arm is its sleeve and arm together,
pivoting at the middle of the shoulder seam, so the fabric moves with the
limb. Each sleeve is closed off with a rounded, shaded cap past its seam, so
it reads as a complete sleeve at any angle. The arms sit *under* the torso,
which hides the caps at rest.

Every hidden filler (shoulders, top of the legs, neck) is made by continuing
the neighbouring pixels, not flat colour, and is clipped to where another
part covers it at rest - so the resting figure is unchanged and fillers only
show through gaps that movement opens.

Before cutting, the source edges are cleaned: the art was drawn on a light
background, so its outline carries a pale fringe that shows as soon as a
limb moves over something else. Colours within a few pixels of the
silhouette are replaced by the nearest solid interior colour.

    python build_stu_rig.py                     # writes the layers
    python build_stu_rig.py --preview out.png   # also a contact sheet of test poses
"""
import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ASSETS = Path(__file__).resolve().parent / "static" / "stu-avatar" / "assets"
OUT = ASSETS / "rig"

# Joint positions on the 690x750 canvas - keep in sync with RIG in stu-avatar.js.
PIVOTS = {
    "arm-l": (254, 372),  # middle of the shoulder seam
    "arm-r": (438, 372),
    "feet": (345, 705),   # legs squash toward the floor for knee bends
    "head": (340, 328),
}

# Shoulder seams (where the sleeve meets the shirt body) as straight lines:
# (x at y=330, x at y=430), traced from the art.
SEAMS = {
    "idle-l": (250, 257),
    "idle-r": (437, 444),
    "open-l": (262, 257),
    "open-r": (430, 436),
}
SLEEVE_ROWS = (318, 434)
# Legs: the visible leg is too short (~35px above any knee) for a knee joint
# to look right, so each leg is one piece from the shorts' hem into the shoe,
# jointed at the ankle, where the shoe's collar hides the seam. The leg piece
# pivots at the hem; the shoe follows the foot.
HIP_Y = 568   # at the hem, so the hidden top of the leg barely moves when it swings out
FOOT_Y = 705
ANKLE_Y = {}  # measured per leg: the middle of the shoe collar
# Eyebrow search boxes (screen left/right) and the part-closed eyelid levels.
BROW_BOXES = {"l": (255, 166, 310, 202), "r": (366, 160, 424, 198)}
LID_LEVELS = (0.20, 0.35, 0.50, 0.65)
# The closed-eye and mouth overlays sit at these canvas rects (1024-canvas
# rects from stu-avatar.js minus the crop offset 170,160).
EYES_RECT = (415 - 170, 340 - 160, 190, 90)
MOUTH_RECT = (445 - 170, 405 - 160, 130, 80)
FRINGE_PX = 3
# The shirt's outline under each sleeve (screen-left side; mirrored for the
# right around x=345): from the collar over a rounded shoulder cap, tapering
# in to the shirt's real side edge at the armpit (x=249, traced from the art)
# and straight down it to the hem. When an arm lifts, this is the shirt you
# see - drawn as one clean, anti-aliased edge, never the ragged cut lines.
BODY_UNDER_SLEEVE_L = [(268, 316), (256, 319), (246, 325), (240, 334), (237, 346), (238, 360), (243, 390),
                       (248, 420), (249, 432), (249, 478), (275, 478), (275, 316)]
# The shirt's visible edges have a soft grey shading line; the rebuilt sides
# darken toward the edge to match (factor at the edge, px to full brightness).
SIDE_SHADE = (0.8, 7)
# Each sleeve is closed off at the shoulder with a thin rounded rim past its
# seam - a finished fabric edge - so when the arm swings you see the end of a
# complete sleeve, not a cut. The rim is a slim ellipse centred on the seam
# (half-width; its height spans wherever that sleeve's fabric meets the seam)
# that bulges ~9px at the middle and tapers to nothing at the ends, hidden
# under the body at rest. CAP_SHADE
# darkens it toward its edge like the sleeves' own edges (factor at the edge,
# px to full brightness).
SLEEVE_CAP = 9
CAP_SHADE = (0.7, 5)


def load(name):
    return np.array(Image.open(ASSETS / name).convert("RGBA"))


def defringe(img, band=FRINGE_PX):
    """Replace colours near the silhouette with the nearest solid interior
    colour, removing the light matte the art was drawn against. Alpha (the
    anti-aliasing) is kept."""
    alpha = img[..., 3]
    core = ndimage.binary_erosion(alpha >= 250, iterations=band)
    _, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
    out = img.copy()
    edge = (alpha > 0) & ~core
    out[edge, :3] = img[iy[edge], ix[edge], :3]
    return out


def skin_mask(img):
    rgb = img[..., :3].astype(np.float32) / 255
    mx, mn = rgb.max(-1), rgb.min(-1)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(b >= mx - 1e-6, 240 + 60 * (r - g) / np.maximum(mx - mn, 1e-6), 0)
    return (h >= 186) & (h <= 214) & (s >= 0.28) & (mx >= 0.30) & (img[..., 3] > 20)


def component(mask, seed, box):
    """The connected part of mask (inside box) containing seed, holes filled."""
    x0, y0, x1, y1 = box
    boxed = np.zeros_like(mask)
    boxed[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
    boxed = ndimage.binary_closing(boxed, iterations=2)
    labels, _ = ndimage.label(boxed)
    label = labels[seed[1], seed[0]]
    assert label, f"seed {seed} is not on skin"
    return ndimage.binary_dilation(ndimage.binary_fill_holes(labels == label), iterations=1)


def seam_x(seam, yy):
    top, bottom = seam
    return top + (yy - 330) * (bottom - top) / 100


def polygon_alpha(points, shape, supersample=4):
    """Anti-aliased coverage (0..1) of a polygon."""
    s = supersample
    im = Image.new("L", (shape[1] * s, shape[0] * s), 0)
    ImageDraw.Draw(im).polygon([(x * s, y * s) for x, y in points], fill=255)
    return np.array(im.resize((shape[1], shape[0]), Image.BOX)).astype(np.float32) / 255


def polygon_mask(points, shape):
    im = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(im).polygon(points, fill=255)
    return np.array(im) > 0


def cap_sleeve(arm, src, fabric, seam, side, yy, xx, hidden=None, supersample=4):
    """Close the sleeve's cut end with a rounded cap: an anti-aliased half
    ellipse past the seam (side -1: sleeve is left of the seam, +1: right),
    filled with the sleeve's own fabric and shaded toward its rim. Drawn under
    the arm's pixels."""
    h, w = arm.shape[:2]
    # The rim spans exactly the rows where this sleeve's fabric meets the seam.
    at_seam = fabric & (np.abs(xx - seam_x(seam, yy)) < 8)
    rows_at_seam = np.nonzero(at_seam.any(axis=1))[0]
    top, bottom = rows_at_seam.min(), rows_at_seam.max()
    rx, ry, cy = SLEEVE_CAP, (bottom - top) / 2, (top + bottom) / 2
    cx = seam_x(seam, cy)
    ss = supersample
    im = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(im).ellipse([(cx - rx) * ss, (cy - ry) * ss, (cx + rx) * ss, (cy + ry) * ss], fill=255)
    ellipse = np.array(im.resize((w, h), Image.BOX)).astype(np.float32) / 255
    past_seam = np.clip((xx - seam_x(seam, yy)) * -side + 1.0, 0, 1)  # 1 on the body side of the seam
    cap_alpha = ellipse * past_seam
    if hidden is not None:
        # Only where the body covers it at rest (softened so the clip edge
        # doesn't turn into a new hard cut).
        cap_alpha *= np.clip(ndimage.gaussian_filter(hidden.astype(np.float32), 1.0) * 1.5, 0, 1)
    # Fabric texture from inside the sleeve, softened.
    core = ndimage.binary_erosion(fabric, iterations=3)
    _, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
    fill = src[iy, ix, :3].astype(np.float32)
    fill = np.stack([ndimage.gaussian_filter(fill[..., c], 2.5) for c in range(3)], -1)
    # Shade toward the rim (distance inside the ellipse).
    inside = ndimage.distance_transform_edt(ellipse > 0.5)
    rim, px = CAP_SHADE
    shade = rim + (1 - rim) * np.clip(inside / px, 0, 1)
    cap = np.zeros_like(arm)
    cap[..., :3] = np.clip(fill * shade[..., None], 0, 255).astype(np.uint8)
    cap[..., 3] = (cap_alpha * 255).astype(np.uint8)
    return under(cap, arm)


def brow_mask(img, box):
    """An eyebrow: the dark-blue stroke inside box, on the face's own skin."""
    x0, y0, x1, y1 = box
    rgb = img[..., :3].astype(float)
    lum = rgb @ [0.299, 0.587, 0.114]
    blue = (rgb[..., 2] - rgb[..., 0]) > 25
    sub, subblue = lum[y0:y1, x0:x1], blue[y0:y1, x0:x1]
    skin = np.median(sub[subblue])
    dark = (sub < skin - 30) & subblue
    labels, n = ndimage.label(dark)
    sizes = ndimage.sum(dark, labels, range(1, n + 1))
    mask = np.zeros(img.shape[:2], bool)
    mask[y0:y1, x0:x1] = labels == (np.argmax(sizes) + 1)
    mask = ndimage.binary_fill_holes(ndimage.binary_closing(mask, iterations=2))
    return ndimage.binary_dilation(mask, iterations=2)


# Each eye opening (rim included), traced from the art: centre and radii.
EYE_OPENINGS = {"l": (288, 223.5, 26.5, 27.5), "r": (391, 223.5, 25.5, 27.5)}
LASH_COLOR = (24, 42, 66)


def lid_levels(src):
    """Part-closed upper eyelids, drawn at full resolution inside each eye
    opening: skin carried down from just above the eye, a crisp curved edge
    with a lash line, and a soft shadow on the eyeball under it. Returned as
    images covering EYES_RECT, like the closed-eye overlay."""
    ex, ey, ew, eh = EYES_RECT
    h, w = src.shape[:2]
    ss = 4
    yy, xx = np.mgrid[0:h, 0:w]
    skin = skin_mask(src) & (src[..., 3] > 250)
    out = {}
    for level in LID_LEVELS:
        canvas = np.zeros((h, w, 4), np.float32)
        for cx, cy, rx, ry in EYE_OPENINGS.values():
            # Anti-aliased coverage of the opening (grown a touch to cover the rim).
            big = Image.new("L", (w * ss, h * ss), 0)
            ImageDraw.Draw(big).ellipse([(cx - rx - 1.5) * ss, (cy - ry - 1.5) * ss, (cx + rx + 1.5) * ss, (cy + ry + 1.5) * ss], fill=255)
            inside = np.array(big.resize((w, h), Image.BOX)).astype(np.float32) / 255
            # Lid edge: a curve that sags slightly in the middle, at `level` of the way down.
            u = np.clip((xx - cx) / rx, -1, 1)
            edge = (cy - ry) + level * 2 * ry + 0.12 * ry * (1 - u ** 2)
            cover = np.clip(edge - yy + 0.5, 0, 1) * inside  # 1 above the edge, anti-aliased at it
            # Skin: each column carries down the skin just above the eye's top
            # edge (like a lid sliding down), softened sideways so it blends.
            fill = np.zeros((h, w, 3), np.float32)
            x_lo, x_hi = int(cx - rx - 3), int(cx + rx + 4)
            cols = []
            for x in range(x_lo, x_hi):
                uu = min(1.0, abs((x - cx) / (rx + 1.5)))
                top = int(cy - (ry + 1.5) * np.sqrt(1 - uu ** 2)) - 3
                band = src[max(0, top - 5):top, x, :3].astype(np.float32)
                band = band[skin[max(0, top - 5):top, x]] if skin[max(0, top - 5):top, x].any() else band
                cols.append(band.mean(axis=0))
            cols = np.array(cols)
            cols = np.stack([ndimage.gaussian_filter1d(cols[:, c], 2.0, mode="nearest") for c in range(3)], -1)
            fill[:, x_lo:x_hi] = cols[None, :, :]
            # Lid curvature: slightly darker toward its edge.
            depth = np.clip((edge - yy) / 6, 0, 1)
            fill *= (0.9 + 0.1 * depth)[..., None]
            # Lash line along the edge, and a soft shadow on the eye below it.
            dist = yy - edge  # >0 below the edge
            lash = np.clip(1.3 - np.abs(dist + 0.6) / 1.1, 0, 1) * inside
            shadow = np.clip(1 - dist / 5, 0, 1) * (dist > 0) * 0.35 * inside
            rgb = fill * cover[..., None]
            alpha = cover.copy()
            for c in range(3):
                rgb[..., c] = rgb[..., c] * (1 - lash) + LASH_COLOR[c] * lash
            alpha = np.maximum(alpha, lash)
            # Shadow: dark, partly transparent, only where the lid isn't.
            shade_a = shadow * (1 - alpha)
            rgb = rgb + np.array(LASH_COLOR, np.float32) * shade_a[..., None]
            alpha = alpha + shade_a
            mask = inside > 0
            canvas[mask, :3] = np.where(alpha[mask, None] > 0, rgb[mask] / np.maximum(alpha[mask, None], 1e-6), 0)
            canvas[mask, 3] = np.maximum(canvas[mask, 3], alpha[mask])
        img = np.zeros((eh, ew, 4), np.uint8)
        crop = canvas[ey:ey + eh, ex:ex + ew]
        img[..., :3] = np.clip(crop[..., :3], 0, 255).astype(np.uint8)
        img[..., 3] = np.clip(crop[..., 3] * 255, 0, 255).astype(np.uint8)
        out[level] = img
    return out


def layer(src, mask):
    out = src.copy()
    out[..., 3] = np.where(mask, src[..., 3], 0)
    return out


def continue_pixels(src, source_mask, fill_mask, blur=2.0):
    """Fill fill_mask with the colour of the nearest source_mask pixel (then
    soften), so a hidden filler looks like the neighbouring material carrying
    on rather than a flat block."""
    _, (iy, ix) = ndimage.distance_transform_edt(~source_mask, return_indices=True)
    filled = src[iy, ix, :3].astype(np.float32)
    if blur:
        filled = np.stack([ndimage.gaussian_filter(filled[..., c], blur) for c in range(3)], -1)
    out = np.zeros_like(src)
    out[fill_mask, :3] = np.clip(filled[fill_mask], 0, 255).astype(np.uint8)
    out[fill_mask, 3] = 255
    return out


def under(filler, top):
    """Composite `top` over `filler`."""
    base = Image.fromarray(filler)
    base.alpha_composite(Image.fromarray(top))
    return np.array(base)


LEG_X = {}


def build():
    idle = defringe(load("stu-idle.webp"))
    opened = defringe(load("stu-open.webp"))
    h, w = idle.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    opaque = idle[..., 3] > 8
    solid = idle[..., 3] > 250
    skin = skin_mask(idle)
    rows = (yy >= SLEEVE_ROWS[0]) & (yy <= SLEEVE_ROWS[1])

    # --- head: cap and everything above the collar, plus the face down to the chin.
    face = component(skin, (340, 250), (200, 120, 480, 352))
    head = ((yy < 300) & opaque) | (face & (yy >= 300) & opaque)
    # The jaw is cut along a colour boundary, which is ragged: round it off so
    # it stays a clean curve when the head sways.
    jaw = yy >= 290
    smooth = ndimage.binary_opening(ndimage.binary_closing(head, iterations=3), iterations=2)
    head = np.where(jaw, smooth & opaque, head)

    # --- arms: sleeve (outside the shoulder seam) + the arm below it. Below
    # the sleeves, the arm's soft edge and rim light (which the skin test
    # misses) go with whichever is nearer - the arm or the shirt/shorts - so
    # neither ends up with a straight cut or a sliver of the other.
    arm_l = component(skin, (200, 480), (145, 392, 262, 605))
    arm_r = component(skin, (485, 480), (428, 392, 545, 605))
    body_core = solid & ~skin & (xx >= 246) & (xx <= 444) & (yy >= 330) & (yy <= 600)
    d_body = ndimage.distance_transform_edt(~body_core)
    beside = opaque & (yy >= 425) & (yy <= 605)
    near_l = beside & (ndimage.distance_transform_edt(~arm_l) < d_body) & (xx < 300)
    near_r = beside & (ndimage.distance_transform_edt(~arm_r) < d_body) & (xx > 390)
    sleeve_l = opaque & rows & (xx < seam_x(SEAMS["idle-l"], yy)) & ~head
    sleeve_r = opaque & rows & (xx > seam_x(SEAMS["idle-r"], yy)) & ~head
    limb_l = (arm_l & opaque) | near_l | sleeve_l
    limb_r = (arm_r & opaque) | near_r | sleeve_r

    # --- legs: cut where the leg's skin starts under the shorts. Everything
    # above - including the dark rim and shadow along the bottom of the
    # shorts - stays with the shorts, so a moving leg takes only skin with it.
    # Per column: the first row of leg skin below the shorts, then smoothed.
    rgb = idle[..., :3].astype(int)
    navy = (idle[..., 3] > 200) & (rgb[..., 0] < 40) & (rgb[..., 1] < 50) & (rgb[..., 2] < 88)  # shorts fabric
    hem = np.full(w, np.nan)
    for x in range(196, 495):
        col = skin[545:640, x] & solid[545:640, x]
        # Need a few skin rows in a row, so stray bluish specks in the rim don't count.
        run = np.convolve(col.astype(int), np.ones(4, int), mode="valid") == 4
        ys = np.nonzero(run)[0]
        if len(ys):
            hem[x] = 545 + ys[0]
    valid = ~np.isnan(hem)
    hem = np.interp(np.arange(w), np.nonzero(valid)[0], hem[valid])
    hem = ndimage.median_filter(hem, size=9)
    # The leg's dark outline columns have no skin, so their cut lands too low:
    # take the highest cut nearby so the outline goes with the leg too.
    hem = ndimage.minimum_filter1d(hem, 9)
    hem = np.round(ndimage.gaussian_filter1d(hem, 2.5, mode="nearest") + 1).astype(int)
    legs = (yy >= hem[None, :]) & opaque & ~limb_l & ~limb_r & (yy > 540)

    leg_l = legs & (xx >= 196) & (xx < 345)
    leg_r = legs & (xx >= 345) & (xx <= 494)

    torso = opaque & ~limb_l & ~limb_r & ~leg_l & ~leg_r & ~head

    # The shirt's sides under the sleeves. Where the arm met the torso, the
    # torso ends in a jagged split line that looks torn once the arm moves. So
    # the side is rebuilt as one smooth outline just outside the torso's
    # outermost pixels (so the jagged line is always inside solid shirt), with
    # the rounded shoulder cap of BODY_UNDER_SLEEVE_L on top - and clipped to
    # the original art's silhouette, so nothing changes at rest.
    side_rows = (yy >= 316) & (yy <= 478)
    cap_l = polygon_alpha(BODY_UNDER_SLEEVE_L, (h, w)) > 0.5
    outline = {}
    for side, half in (("l", xx < 345), ("r", xx >= 345)):
        edge = np.full(h, np.nan)
        for y in range(316, 479):
            cols = np.nonzero((torso[y] | (cap_l[y] if side == "l" else cap_l[y, ::-1])) & half[y])[0]
            if len(cols):
                edge[y] = cols.min() if side == "l" else cols.max()
        valid = ~np.isnan(edge)
        edge = np.interp(np.arange(h), np.nonzero(valid)[0], edge[valid])
        # Envelope: the outermost point nearby, then smoothed - staying outside.
        env = ndimage.minimum_filter1d(edge, 9) if side == "l" else ndimage.maximum_filter1d(edge, 9)
        smooth = ndimage.gaussian_filter1d(env, 3)
        outline[side] = np.minimum(smooth, env) - 0.5 if side == "l" else np.maximum(smooth, env) + 0.5
    cover_l = np.clip(xx - outline["l"][:, None] + 0.5, 0, 1) * (xx < 345)
    cover_r = np.clip(outline["r"][:, None] - xx + 0.5, 0, 1) * (xx >= 345)
    side_alpha = (cover_l + cover_r) * side_rows * (idle[..., 3] / 255.0)
    # Distance in from the outline, for edge shading.
    inside_px = np.where(xx < 345, xx - outline["l"][:, None], outline["r"][:, None] - xx)
    layers = {}

    # Torso, with a neck behind the chin: skin under the bottom of the head,
    # hidden by the head at rest and seen only when it tilts or nods.
    neck_fill = head & solid & (yy >= 286) & (xx > 248) & (xx < 432)
    neck = continue_pixels(idle, face & solid & (yy > 270) & (yy < 300), neck_fill, blur=3.0)
    layers["torso"] = under(neck, layer(idle, torso))
    # Eyebrows as their own layers; the forehead under them is filled with the
    # surrounding skin so a brow can move without leaving its old shape behind.
    head_img = idle.copy()
    brows = {}
    for side, box in BROW_BOXES.items():
        brow = brow_mask(idle, box)
        brows[side] = brow
        hole = ndimage.binary_dilation(brow, iterations=3)
        ring = ndimage.binary_dilation(brow, iterations=10) & ~hole & skin & solid
        patch = continue_pixels(idle, ring, hole, blur=2.5)
        head_img[hole, :3] = patch[hole, :3]
        soft = np.clip(ndimage.gaussian_filter(brow.astype(float), 0.7) * 1.4, 0, 1)
        brow_layer = idle.copy()
        brow_layer[..., 3] = (soft * idle[..., 3]).astype(np.uint8)
        layers[f"brow-{side}"] = brow_layer
    layers["head"] = layer(head_img, head)

    # Shoulders: the shirt inside that outline, textured from well inside the
    # shirt (so edge shading doesn't smear), shaded toward its outer edge.
    shirt_core = ndimage.binary_erosion(torso & solid & ~navy, iterations=6) & (yy >= 330) & (yy <= 478)
    _, (iy, ix) = ndimage.distance_transform_edt(~shirt_core, return_indices=True)
    fill = idle[iy, ix, :3].astype(np.float32)
    fill = np.stack([ndimage.gaussian_filter(fill[..., c], 4) for c in range(3)], -1)
    edge_factor, edge_px = SIDE_SHADE
    shade = edge_factor + (1 - edge_factor) * np.clip(inside_px / edge_px, 0, 1)
    shoulders = np.zeros_like(idle)
    shoulders[..., :3] = np.clip(fill * shade[..., None], 0, 255).astype(np.uint8)
    shoulders[..., 3] = np.where(side_rows & ((xx < 275) | (xx > 415)), side_alpha * 255, 0).astype(np.uint8)
    layers["shoulders"] = shoulders

    # Arms, each sleeve closed off with its rounded cap (hidden under the
    # body at rest).
    covered = (torso | head) & solid
    layers["arm-l"] = cap_sleeve(layer(idle, limb_l), idle, sleeve_l & ~skin & solid, SEAMS["idle-l"], -1, yy, xx, covered)
    layers["arm-r"] = cap_sleeve(layer(idle, limb_r), idle, sleeve_r & ~skin & solid, SEAMS["idle-r"], 1, yy, xx, covered)

    # Open arms: sleeve + arm from the open pose. Keep the open pose's head
    # and cap out (they overlap these rows near the seam).
    o_opaque = opened[..., 3] > 8
    o_skin = skin_mask(opened)
    o_rows = (yy >= 318) & (yy <= 406)
    # Keep the open pose's head, collar and shoulder tops out of the arms: the
    # sleeves' top edges run at about y=334, anything above near the body is shirt.
    o_head_zone = ((yy < 330) & (xx > 235) & (xx < 455)) | ((yy < 337) & (xx > 247) & (xx < 443))
    # Round off each open sleeve's bottom corner at the seam: the sleeve's lower
    # edge meets the seam at a sharp angle that sticks out as a spike when the
    # arm is raised. Trim a curve rising toward the seam over the last 24px.
    for seam, side in ((SEAMS["open-l"], -1), (SEAMS["open-r"], 1)):
        dist = (seam_x(seam, yy) - xx) * -side  # px from the seam, on the sleeve side
        corner = (dist >= -2) & (dist < 24) & (yy > 406 - (24 - np.clip(dist, 0, 24)) ** 2 / 24)
        o_head_zone |= corner & (yy > 370)
    out_l = (component(o_skin, (100, 335), (15, 262, 236, 425)) & o_opaque) | (o_opaque & o_rows & (xx < seam_x(SEAMS["open-l"], yy)) & (xx > 150))
    out_r = (component(o_skin, (590, 335), (452, 262, 675, 425)) & o_opaque) | (o_opaque & o_rows & (xx > seam_x(SEAMS["open-r"], yy)) & (xx < 540))
    o_solid = opened[..., 3] > 250
    sleeve_ol = out_l & ~o_head_zone & ~o_skin & o_solid & o_rows
    sleeve_or = out_r & ~o_head_zone & ~o_skin & o_solid & o_rows
    layers["arm-l-out"] = cap_sleeve(layer(opened, out_l & ~o_head_zone), opened, sleeve_ol, SEAMS["open-l"], -1, yy, xx)
    layers["arm-r-out"] = cap_sleeve(layer(opened, out_r & ~o_head_zone), opened, sleeve_or, SEAMS["open-r"], 1, yy, xx)

    # Legs: leg piece (continuing up under the shorts by repeating its own top
    # pixels, and down under the shoe collar) and shoe, cut along the collar.
    ankle = np.full(w, np.nan)
    for x in range(196, 495):
        col = skin[612:700, x]
        if not col[:6].any():
            continue
        run = np.convolve((~col & opaque[612:700, x]).astype(int), np.ones(4, int), mode="valid") == 4
        ys = np.nonzero(run)[0]
        if len(ys):
            ankle[x] = 612 + ys[0]
    valid = ~np.isnan(ankle)
    ankle = np.interp(np.arange(w), np.nonzero(valid)[0], ankle[valid])
    ankle = np.round(ndimage.gaussian_filter1d(ndimage.median_filter(ankle, size=11), 3, mode="nearest")).astype(int)
    below_collar = yy >= ankle[None, :]
    for side, mask in (("l", leg_l), ("r", leg_r)):
        up = np.zeros_like(mask)
        for x in range(w):
            y = hem[x]
            if mask[y:y + 10, x].any():
                up[max(0, y - 22):y + 2, x] = True
        up &= torso & solid
        leg_part = mask & ~below_collar
        shoe_part = mask & below_collar
        # Under the collar: the leg carries on a little, hidden by the shoe at rest.
        down = shoe_part & (yy < ankle[None, :] + 14) & solid
        leg_img = under(continue_pixels(idle, leg_part & solid, up | down, blur=1.0), layer(idle, leg_part))
        layers[f"leg-{side}"] = leg_img
        layers[f"shoe-{side}"] = layer(idle, shoe_part)
        cols = np.nonzero(leg_part[600])[0]
        LEG_X[side] = int(round((cols.min() + cols.max()) / 2))
        ANKLE_Y[side] = int(np.median(ankle[cols.min():cols.max() + 1]))

    OUT.mkdir(exist_ok=True)
    for name, arr in layers.items():
        Image.fromarray(arr).save(OUT / f"{name}.webp", lossless=False, quality=92, method=6)
    for old in ("thigh-l", "thigh-r", "shin-l", "shin-r"):  # replaced by leg + shoe
        (OUT / f"{old}.webp").unlink(missing_ok=True)

    # Part-closed eyelids, drawn inside the eye openings.
    for level, arr in lid_levels(idle).items():
        Image.fromarray(arr).save(OUT / f"eyes-lid-{round(level * 100)}.png")

    # A closed, flat mouth from the thinking pose, feathered into the face.
    think = defringe(load("stu-think.webp"))
    mx, my, mw, mh = MOUTH_RECT
    patch = think[my:my + mh, mx:mx + mw].copy()
    pyy, pxx = np.mgrid[0:mh, 0:mw]
    # The frown sits at canvas (330-380, 285-292); the thinking pose's finger
    # is just below it, so keep the patch tight.
    cx, cy = 355 - mx, 289 - my
    d = np.sqrt(((pxx - cx) / 34) ** 2 + ((pyy - cy) / 10) ** 2)
    patch[..., 3] = (np.clip((1.25 - d) / 0.35, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(patch).save(OUT / "mouth-flat.png")
    return layers, idle


def out_angle():
    """Angle between the hanging and open-arm sprites, measured from the
    shoulder pivot to the hand, so the two line up where they cross-fade."""
    px, py = PIVOTS["arm-l"]
    hang = math.degrees(math.atan2(px - 195, 580 - py))  # hanging hand, outward from straight down
    held = math.degrees(math.atan2(px - 60, 350 - py))   # open hand
    return round(held - hang)


def compose(layers, arm_l=4.0, arm_r=4.0, head=0.0, bg=(250, 249, 247, 255)):
    """Rough Python stand-in for the browser rig, for the preview sheet."""
    size = (layers["torso"].shape[1], layers["torso"].shape[0])
    canvas = Image.new("RGBA", size, bg)
    oa = out_angle()

    def put(name, angle=0.0, pivot=(0, 0), alpha=1.0):
        im = Image.fromarray(layers[name])
        if angle:
            im = im.rotate(angle, center=pivot, resample=Image.BICUBIC)
        if alpha < 1:
            a = np.array(im)
            a[..., 3] = (a[..., 3] * alpha).astype(np.uint8)
            im = Image.fromarray(a)
        canvas.alpha_composite(im)

    put("leg-l")
    put("leg-r")
    put("shoe-l")
    put("shoe-r")
    put("shoulders")
    # PIL rotates counter-clockwise for positive angles; the screen-left arm
    # raises clockwise.
    for side, a, sign in (("l", arm_l, -1), ("r", arm_r, 1)):
        f = min(1, max(0, (a - 38) / 8))
        pivot = PIVOTS[f"arm-{side}"]
        if f < 1:
            put(f"arm-{side}", sign * a, pivot, 1 - f)
        if f > 0:
            put(f"arm-{side}-out", sign * (a - oa), pivot, f)
    put("torso")
    put("head", -head, PIVOTS["head"])
    return canvas


def preview(layers, path):
    oa = out_angle()
    frames = [
        ("rest", {}), ("arms 25", dict(arm_l=25, arm_r=25)), ("arms 60", dict(arm_l=60, arm_r=60)),
        ("open", dict(arm_l=oa, arm_r=oa)), ("wave", dict(arm_l=8, arm_r=145)),
        ("cheer", dict(arm_l=150, arm_r=150)), ("shrug", dict(arm_l=55, arm_r=55, head=4)),
        ("dark bg", dict(arm_l=oa, arm_r=30, bg=(30, 30, 40, 255))),
    ]
    tiles = []
    for label, kw in frames:
        im = compose(layers, **kw).resize((345, 375), Image.LANCZOS)
        ImageDraw.Draw(im).text((8, 8), label, fill=(200, 0, 0, 255))
        tiles.append(im)
    sheet = Image.new("RGBA", (345 * 4, 375 * 2), (255, 255, 255, 255))
    for i, t in enumerate(tiles):
        sheet.alpha_composite(t, ((i % 4) * 345, (i // 4) * 375))
    sheet.convert("RGB").save(path)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", help="write a contact sheet PNG here")
    args = ap.parse_args()
    built, _ = build()
    print("wrote", ", ".join(sorted(built)), "to", OUT)
    print("outAngle (RIG.outAngle in stu-avatar.js):", out_angle())
    print("leg x (RIG legs in stu-avatar.js):", LEG_X, "ankle y:", ANKLE_Y, "hip/foot y:", HIP_Y, FOOT_Y)
    for side, box in BROW_BOXES.items():
        ys, xs = np.nonzero(brow_mask(defringe(load("stu-idle.webp")), box))
        print(f"brow-{side} centre:", int(xs.mean()), int(ys.mean()))
    if args.preview:
        preview(built, args.preview)
        print("preview:", args.preview)
