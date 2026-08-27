"""
Pull the wire off the plate.

Binarise, split into connected pieces, thin each piece to a one-pixel
centreline, then walk that centreline into ordered polylines — cutting at every
junction, so a glyph that crosses itself comes back as separate lengths of wire.

What falls out is the path the smith actually bent, at the size he actually bent
it, which is the only honest source for letters this plate never shows. The
letters are then assembled out of these pieces rather than redrawn in their
manner.

    python3 farm/type/extract.py   ->   src/type/plate.ts
"""
import json
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = "Type/sample.jpeg"
OUT = "src/type/plate.ts"

# One em is one figure height. Row baselines are where the figures in that row
# sit; keeping them separate preserves the plate's own unevenness for free.
EM = 300.0
BASELINE = {0: 468.0, 1: 890.0}

# id -> (name, row). Read off the plate; see farm/type/_map.py to regenerate
# the labelled overlay if the source image is ever replaced.
PIECES = {
    3:  ("one.arch",      0),   # the 1 — an arch, legs and all
    6:  ("two",           0),
    7:  ("three",         0),
    11: ("four.bent",     0),   # diagonal + mitre + bar, one wire
    12: ("four.stem",     0),
    8:  ("four.rivet",    0),
    14: ("five.bowl",     0),
    2:  ("five.crook",    0),
    13: ("five.rivet",    0),
    1:  ("six",           0),   # long sweep into a circular bulb
    5:  ("seven",         0),   # bar + mitre + long diagonal
    4:  ("eight",         0),
    23: ("nine",          1),   # bulb + long straight tail
    28: ("ten",           1),   # an n and a b, joined
    29: ("bar.tall",      1),
    24: ("bar.tall.b",    1),
    31: ("bar.short",     1),
    27: ("two.alt",       1),
    33: ("one.arch.b",    1),
    32: ("seven.b",       1),
    35: ("four.bent.b",   1),
    36: ("four.stem.b",   1),
    34: ("ring",          1),   # the 0 — a true circle with a seam
}


# --------------------------------------------------------------------------
# thinning
# --------------------------------------------------------------------------

def thin(m):
    """Zhang-Suen. Erodes to a one-pixel spine without breaking connectivity."""
    m = m.astype(np.uint8).copy()
    while True:
        changed = False
        for step in (0, 1):
            p = np.pad(m, 1)
            P2 = p[:-2, 1:-1]; P3 = p[:-2, 2:]; P4 = p[1:-1, 2:]; P5 = p[2:, 2:]
            P6 = p[2:, 1:-1];  P7 = p[2:, :-2]; P8 = p[1:-1, :-2]; P9 = p[:-2, :-2]
            seq = [P2, P3, P4, P5, P6, P7, P8, P9, P2]
            B = sum(seq[:8])
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
            if step == 0:
                c = (P2 * P4 * P6 == 0) & (P4 * P6 * P8 == 0)
            else:
                c = (P2 * P4 * P8 == 0) & (P2 * P6 * P8 == 0)
            kill = (m == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if kill.any():
                m[kill] = 0
                changed = True
        if not changed:
            return m.astype(bool)


NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
# the 8 neighbours in ring order, for the crossing number
RING = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]


def crossings(pts, p):
    """
    How many separate arms leave this pixel.

    Counting neighbours directly does not work: a thinned diagonal is a
    staircase, and a pixel on one has an orthogonal neighbour AND a diagonal
    one on the same side, which reads as three arms and cuts a straight run
    into pieces. Counting 0->1 transitions around the ring instead groups
    touching neighbours into one arm, so a middle pixel scores 2 wherever it
    sits and only a genuine crossing scores more.
    """
    r = [(p[0] + dy, p[1] + dx) in pts for dy, dx in RING]
    return sum(1 for i in range(8) if not r[i] and r[(i + 1) % 8])


def walk(skel):
    """
    Split the spine into ordered polylines, cut at every crossing.

    A closed loop like the 0 has no ends and no crossings, so it is broken at
    an arbitrary pixel and comes back as one path that finishes where it began.
    """
    pts = {(int(y), int(x)) for y, x in zip(*np.nonzero(skel))}
    nodes = {p for p in pts if crossings(pts, p) != 2}
    paths, seen = [], set()

    def step_from(b):
        return [(b[0] + dy, b[1] + dx) for dy, dx in NB
                if (b[0] + dy, b[1] + dx) in pts
                and frozenset((b, (b[0] + dy, b[1] + dx))) not in seen]

    def run(a, b):
        path = [a, b]
        seen.add(frozenset((a, b)))
        while b not in nodes:
            nxt = step_from(b)
            if not nxt:
                break
            # prefer the orthogonal step so a staircase is walked in order
            nxt.sort(key=lambda q: abs(q[0] - b[0]) + abs(q[1] - b[1]))
            seen.add(frozenset((b, nxt[0])))
            path.append(nxt[0])
            b = nxt[0]
        return path

    for a in nodes:
        for dy, dx in NB:
            b = (a[0] + dy, a[1] + dx)
            if b in pts and frozenset((a, b)) not in seen:
                paths.append(run(a, b))

    # whatever is left has no ends and no crossings: a ring
    for a in sorted(pts):
        nxt = step_from(a)
        if nxt:
            paths.append(run(a, nxt[0]))
    return paths


def rejoin(paths, stroke):
    """
    Put the smith's strokes back together across the crossings.

    Cutting at every junction is right for finding pieces but wrong for
    describing them: where the 6's loop closes onto its own stem, or the 8
    crosses at the waist, one continuous bend comes back as four stubs. At each
    crossing the two ends that carry on in the same direction are the same
    piece of wire, so pair the incident ends by how nearly anti-parallel their
    tangents are, and splice. What is left is what was actually bent — which is
    then cut deliberately, by arc length, when the letters are assembled.
    """
    ends = []          # (cluster key, path index, which end)
    def tip(p, at_end):
        q = p[::-1] if at_end else p
        k = min(len(q) - 1, max(2, int(stroke)))
        return np.array(q[0], float), np.array(q[0], float) - np.array(q[k], float)

    for i, p in enumerate(paths):
        for e in (0, 1):
            ends.append([i, e, *tip(p, e == 1)])

    # cluster ends that sit on the same crossing
    groups = []
    used = [False] * len(ends)
    for i, a in enumerate(ends):
        if used[i]:
            continue
        g = [i]; used[i] = True
        for j in range(i + 1, len(ends)):
            if not used[j] and np.hypot(*(ends[j][2] - a[2])) <= stroke * 1.9:
                g.append(j); used[j] = True
        if len(g) > 1:
            groups.append(g)

    mate = {}
    for g in groups:
        free = list(g)
        while len(free) >= 2:
            best, score = None, 0.35     # must be a real carry-through, not a corner
            for x in range(len(free)):
                for y in range(x + 1, len(free)):
                    a, b = ends[free[x]], ends[free[y]]
                    if a[0] == b[0] and len(paths[a[0]]) < 6:
                        continue
                    da = a[3] / (np.linalg.norm(a[3]) or 1)
                    db = b[3] / (np.linalg.norm(b[3]) or 1)
                    v = -float(da @ db)
                    if v > score:
                        best, score = (x, y), v
            if not best:
                break
            x, y = best
            mate[(ends[free[x]][0], ends[free[x]][1])] = (ends[free[y]][0], ends[free[y]][1])
            mate[(ends[free[y]][0], ends[free[y]][1])] = (ends[free[x]][0], ends[free[x]][1])
            for k in sorted((x, y), reverse=True):
                free.pop(k)

    out, done = [], set()
    for i in range(len(paths)):
        if i in done:
            continue
        # walk back to an open end so the chain is traversed once, in order
        cur, side = i, 0
        guard = 0
        while (cur, side) in mate and mate[(cur, side)][0] not in done and guard < 64:
            nxt = mate[(cur, side)]
            if nxt[0] == i:
                break
            cur, side = nxt[0], 1 - nxt[1]
            guard += 1
        chain, at = [], (cur, side)
        guard = 0
        while at and at[0] not in done and guard < 64:
            j, e = at
            done.add(j)
            seg = paths[j][::-1] if e == 1 else paths[j]
            chain.extend(seg if not chain else seg[1:])
            at = mate.get((j, 1 - e))
            guard += 1
        out.append(chain)
    return out


def prune(paths, stroke):
    """Thinning grows whiskers at every cut end. Anything shorter than the wire
    is thick is a whisker, not a piece."""
    out = []
    for p in paths:
        L = sum(np.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) for i in range(1, len(p)))
        if L >= stroke * 1.6:
            out.append(p)
    return out


def smooth(pts, passes=6):
    a = np.asarray(pts, dtype=float)
    closed = np.hypot(*(a[0] - a[-1])) < 2.5
    for _ in range(passes):
        b = a.copy()
        b[1:-1] = (a[:-2] + 2 * a[1:-1] + a[2:]) / 4
        if closed:
            b[0] = b[-1] = (a[-2] + 2 * a[0] + a[1]) / 4
        a = b
    return a


def resample(a, step):
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(a, axis=0).T))]
    if d[-1] < step:
        return a
    t = np.arange(0, d[-1], step)
    t = np.r_[t, d[-1]]
    return np.c_[np.interp(t, d, a[:, 0]), np.interp(t, d, a[:, 1])]


# --------------------------------------------------------------------------

im = np.asarray(Image.open(SRC).convert("L"), dtype=np.uint8)
ink = im < 140
ink[930:, :] = False
lab, n = ndimage.label(ink, structure=np.ones((3, 3), np.uint8))
objs = ndimage.find_objects(lab)

out = {}
gauges = []
for pid, (name, row) in PIECES.items():
    sl = objs[pid - 1]
    m = (lab[sl] == pid)
    area = m.sum()
    sk = thin(m)
    length = sk.sum()
    stroke = area / max(1.0, length)          # wire gauge in pixels
    gauges.append(stroke)
    paths = rejoin(prune(walk(sk), stroke * 0.9), stroke)
    if not paths:
        print(f"  ! {name}: nothing traced", file=sys.stderr)
        continue
    y0, x0 = sl[0].start, sl[1].start
    base = BASELINE[row]
    strands = []
    for p in paths:
        a = resample(smooth(p), max(1.5, stroke * 0.45))
        # pixel (row, col) -> em (x right, y up from the row's baseline)
        xs = (a[:, 1] + x0) / EM
        ys = (base - (a[:, 0] + y0)) / EM
        strands.append([[round(float(x), 4), round(float(y), 4)] for x, y in zip(xs, ys)])
    strands.sort(key=lambda s: -len(s))
    out[name] = strands
    print(f"  {name:<14} {len(paths)} strand(s), gauge {stroke:.1f}px", file=sys.stderr)

gauge_em = float(np.median(gauges)) / EM
print(f"\nmedian gauge {np.median(gauges):.1f}px = {gauge_em:.4f} em", file=sys.stderr)

body = ",\n".join(
    f"  {json.dumps(k)}: [\n" +
    ",\n".join("    " + json.dumps(s) for s in v) +
    "\n  ]"
    for k, v in out.items()
)
with open(OUT, "w") as f:
    f.write(
        "// GENERATED by farm/type/extract.py — do not edit by hand.\n"
        "//\n"
        "// Centrelines traced off the 1740 plate. Each entry is one piece of wire as\n"
        "// the smith left it, cut at every junction, in em units: x runs right, y runs\n"
        "// up from that row's baseline, and one em is one figure height. Sizes are NOT\n"
        "// normalised — the 6 really is taller than the 4, and keeping that is the\n"
        "// whole point.\n\n"
        f"/** Wire gauge measured off the plate, in em. */\nexport const PLATE_GAUGE = {gauge_em:.4f};\n\n"
        "export type Trace = [number, number][];\n\n"
        "export const PLATE: Record<string, Trace[]> = {\n" + body + ",\n};\n"
    )
print(f"\n{OUT}", file=sys.stderr)
