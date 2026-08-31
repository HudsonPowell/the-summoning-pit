"""Composite the title's alpha frames over background treatments.

The word is wire in earth inks — browns, greys, near-black — so it needs a
ground that is clearly LIGHTER or clearly DARKER than the inks. A mid-grey
ramp passing behind the letters is the one thing that turns them to mud, and
that is exactly what a naive black-to-white gradient does.

    python3 farm/social_bg.py <alphaDir> <outDir> <name> ...
"""
import sys, os
from PIL import Image

ALPHA = 'farm/out/social/.frames-title-alpha'
OUT = 'farm/out/social'

# each treatment paints a vertical ramp: (top rgb, bottom rgb)
# the word lives between 0.47 and 0.70 of the frame, so every ramp is chosen
# to be well clear of the inks THERE, not merely at the extremes
TREATMENTS = {
    # the pit's own dark, with just enough lift at the foot to feel like depth
    'gradient-dark':  ((0, 0, 0), (38, 40, 48)),
    # deep and warm, the colour the pit's earth inks came from
    'gradient-earth': ((6, 5, 8), (54, 40, 30)),
    # ink on paper: the wire reads as a drawn mark, fully inverted mood
    'paper':          ((238, 235, 228), (238, 235, 228)),
    # paper with a soft floor shadow, so the word sits on something
    'gradient-paper': ((246, 244, 239), (198, 192, 181)),
}

def ramp(top, bot, w, h):
    img = Image.new('RGB', (1, h))
    px = img.load()
    for y in range(h):
        u = (y / (h - 1)) ** 1.35          # ease, so the change lives low down
        px[0, y] = tuple(int(top[i] + (bot[i] - top[i]) * u) for i in range(3))
    return img.resize((w, h))

def main():
    names = sys.argv[1:] or list(TREATMENTS)
    frames = sorted(f for f in os.listdir(ALPHA) if f.endswith('.png'))
    first = Image.open(os.path.join(ALPHA, frames[0]))
    w, h = first.size
    for name in names:
        top, bot = TREATMENTS[name]
        bg = ramp(top, bot, w, h)
        d = f'{OUT}/.frames-title-{name}'
        os.makedirs(d, exist_ok=True)
        for f in frames:
            fg = Image.open(os.path.join(ALPHA, f)).convert('RGBA')
            out = bg.copy()
            out.paste(fg, (0, 0), fg)
            out.save(os.path.join(d, f))
        print(f'{name}: {len(frames)} frames')

if __name__ == '__main__':
    main()
