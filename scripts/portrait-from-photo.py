"""Photo -> 1-bit halftone pixel portrait rows ('#' dark, '-' light, '.' empty)."""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out_rows, out_png = sys.argv[1], sys.argv[2], sys.argv[3]
COLS = int(sys.argv[4]) if len(sys.argv) > 4 else 60
GLASSES = (sys.argv[5] if len(sys.argv) > 5 else '1') == '1'

im = Image.open(src).convert('RGB')
# head and shoulders: crown to sweater
box = (130, 40, 890, 1010)
im = im.crop(box)
W, H = im.size
rows = round(COLS * H / W)

rgb = np.asarray(im.resize((COLS, rows), Image.LANCZOS)).astype(float)
R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
# background: the blue backdrop
bg = (B - R > 12) & (B > 18)
# keep only background connected to the frame edges (no holes inside the face)
from collections import deque
seen = np.zeros_like(bg)
q = deque([(y, x) for y in range(rows) for x in (0, COLS - 1) if bg[y, x]] + [(0, x) for x in range(COLS) if bg[0, x]])
for y, x in q: seen[y, x] = True
while q:
    y, x = q.popleft()
    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < rows and 0 <= nx < COLS and bg[ny, nx] and not seen[ny, nx]:
            seen[ny, nx] = True; q.append((ny, nx))
background = seen

# tone: luminance, contrast stretched, a little more mid-tone
SHARPEN = float(sys.argv[7]) if len(sys.argv) > 7 else 1.5
CONTRAST = float(sys.argv[8]) if len(sys.argv) > 8 else 1.6
small = im.convert('L').resize((COLS, rows), Image.LANCZOS)
# Sharpen at grid size: eyes, nose and mouth survive the halftone.
small = small.filter(ImageFilter.UnsharpMask(radius=1.2, percent=int(SHARPEN * 100), threshold=0))
gray = np.asarray(small).astype(float) / 255
# The photo is lit hard from the right: take out part of the large-scale light falloff,
# keep the features. Background is filled with the figure's mean before blurring.
FLATTEN = float(sys.argv[6]) if len(sys.argv) > 6 else 0.55
mean = gray[~background].mean()
filled = np.where(background, mean, gray)
blur = np.asarray(Image.fromarray((filled * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(COLS / 7))).astype(float) / 255
gray = gray * (1 - FLATTEN) + np.clip(gray - blur + mean, 0, 1) * FLATTEN
L = np.clip((gray - 0.06) / (0.88 - 0.06), 0, 1) ** 1.05
# S-curve around the middle: cleaner skin, clearer features, less grey noise.
L = np.clip(0.5 + (L - 0.5) * CONTRAST, 0, 1)

# Floyd-Steinberg on the figure only
out = np.zeros_like(L)
err = L.copy()
for y in range(rows):
    # serpentine: alternate direction per row, fewer streaks
    d = 1 if y % 2 == 0 else -1
    for x in (range(COLS) if d == 1 else range(COLS - 1, -1, -1)):
        if background[y, x]: continue
        old = err[y, x]; new = 1.0 if old >= 0.5 else 0.0
        out[y, x] = new; e = old - new
        for dy, dx, w in ((0, d, 7/16), (1, -d, 3/16), (1, 0, 5/16), (1, d, 1/16)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < rows and 0 <= nx < COLS and not background[ny, nx]: err[ny, nx] += e * w

grid = [['.' if background[y, x] else ('-' if out[y, x] > 0.5 else '#') for x in range(COLS)] for y in range(rows)]

if GLASSES:
    # thin round rims over the eyes (photo coordinates -> grid)
    sx, sy = COLS / W, rows / H
    for ex, ey in ((435, 455), (640, 450)):
        cx, cy, r = (ex - box[0]) * sx, (ey - box[1]) * sy, 72 * sx
        for y in range(rows):
            for x in range(COLS):
                if abs(np.hypot(x - cx, (y - cy) * 1.08) - r) < 0.5: grid[y][x] = '#'
    by = (440 - box[1]) * sy
    for x in range(COLS):
        if (510 - box[0]) * sx <= x <= (565 - box[0]) * sx: grid[round(by)][x] = '#'

lines = [''.join(r) for r in grid]
open(out_rows, 'w').write('\n'.join(lines))
P = 10
img = Image.new('RGB', (COLS * P, rows * P), (236, 235, 231))
px = img.load()
for y, r in enumerate(lines):
    for x, c in enumerate(r):
        if c == '.': continue
        v = 22 if c == '#' else 245
        for i in range(P - 1):
            for j in range(P - 1): px[x * P + i, y * P + j] = (v, v, v - 3)
img.save(out_png)
print(COLS, 'x', rows)
