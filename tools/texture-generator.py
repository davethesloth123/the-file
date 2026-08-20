"""
The File — world texture generator.

Emits tiling 512x512 grayscale value maps into public/textures/: an albedo
map (tonal variation around mid-grey; the runtime multiplies it over the
palette colour) and a grime map (1 = clean, darker = dirt) per material.

Everything is VALUE-based, not hue-based — the grade strips most hue, and
under a three-band toon ramp only low-frequency value variation survives:
damp patches, staining, plaster repairs, tonal drift. Fine detail dies.

Seamless tiling comes free from spectral synthesis: noise is built from
random phases in the frequency domain, so wrapping is exact.

Run from the repo root or tools/:  python3 tools/texture-generator.py
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public/textures')
N = 512

def fbm(seed, beta=2.2, aniso=1.0):
    """Tiling fractal noise in [0,1]. beta: spectral slope (higher = softer,
    lower-frequency). aniso > 1 stretches features vertically (streaks)."""
    rng = np.random.default_rng(seed)
    ky = np.fft.fftfreq(N)[:, None]
    kx = np.fft.fftfreq(N)[None, :]
    k = np.sqrt((kx*aniso)**2 + ky**2)
    k[0, 0] = 1.0
    amp = 1.0 / k**beta
    amp[0, 0] = 0.0
    phase = rng.uniform(0, 2*np.pi, (N, N))
    spec = amp * np.exp(1j*phase)
    img = np.real(np.fft.ifft2(spec))
    img -= img.min(); img /= img.max() or 1.0
    return img

def save(name, arr):
    a = np.clip(arr, 0, 1)
    Image.fromarray((a*255).astype(np.uint8), 'L').save(
        os.path.join(OUT, name), optimize=True)
    kb = os.path.getsize(os.path.join(OUT, name))//1024
    print(f'{name:24s} {kb:4d}KB')

def albedo_base(seed, spread=0.10, beta=2.6):
    """Broad tonal drift centred on 0.5."""
    return 0.5 + (fbm(seed, beta) - 0.5) * 2 * spread

def streaks(seed, strength=1.0, beta=2.0):
    """Vertical run-off staining, 1 = clean."""
    s = fbm(seed, beta, aniso=6.0)
    s = s**1.6
    return 1.0 - strength * (1.0 - s)

def main():
    os.makedirs(OUT, exist_ok=True)

    # -- weathered stucco: broad damp blotches + plaster repairs
    a = albedo_base(11, 0.11)
    repairs = (fbm(12, 3.2) > 0.62).astype(float)
    a = a + repairs*0.04                     # lighter patched rectangles-ish
    damp = np.clip((fbm(13, 3.0)-0.55)*2.2, 0, 1)
    a -= damp*0.07                           # damp sinks the value
    save('stucco_albedo.png', a)
    save('stucco_grime.png', np.clip(streaks(14, 0.38) - damp*0.12, 0, 1))

    # -- poured concrete: quiet, with horizontal pour lines
    a = albedo_base(21, 0.05, beta=3.0)
    yy = np.arange(N)[:, None]
    pour = (np.sin(yy/N*np.pi*8 + fbm(22, 3.0)*2.0)**32) * 0.04
    a -= pour
    save('concrete_albedo.png', a)
    save('concrete_grime.png', streaks(23, 0.30))

    # -- wet asphalt: fine grain, broad damp sheets
    a = albedo_base(31, 0.06, beta=1.9)
    wet = np.clip((fbm(32, 3.2)-0.5)*2.0, 0, 1)
    a -= wet*0.09
    save('asphalt_albedo.png', a)
    save('asphalt_grime.png', streaks(33, 0.22, beta=2.6))

    # -- brick: mortar courses + per-course value jitter
    a = albedo_base(41, 0.07, beta=2.2)
    course_h = N//32                          # ~courses read at 2-3m
    yy = np.arange(N)[:, None] % course_h
    mortar = ((yy < 2) | (yy >= course_h-1)).astype(float)
    rng = np.random.default_rng(42)
    rows = np.repeat(rng.uniform(-0.05, 0.05, N//course_h + 1), course_h)[:N]
    a = a + rows[:, None] - mortar*0.10
    save('brick_albedo.png', a)
    save('brick_grime.png', streaks(43, 0.42))

    # -- painted render: flat with peeling patches
    a = albedo_base(51, 0.08, beta=2.8)
    peel = np.clip((fbm(52, 3.4)-0.60)*3.0, 0, 1)
    a += peel*0.09                            # bare plaster shows lighter
    save('render_albedo.png', a)
    save('render_grime.png', streaks(53, 0.34))

    # -- rusted metal: strong vertical banding
    a = albedo_base(61, 0.12, beta=1.8)
    band = fbm(62, 2.0, aniso=8.0)
    a -= (1.0-band)*0.12
    save('metal_albedo.png', a)
    save('metal_grime.png', streaks(63, 0.55, beta=1.8))

    # -- cobblestones: cellular bumps with dark joints (1024 for crispness)
    rng = np.random.default_rng(71)
    NC = 1024
    gx, gy = np.meshgrid(np.arange(NC), np.arange(NC))
    cell = 64
    jx = rng.uniform(-0.35, 0.35, (NC//cell+2, NC//cell+2))
    jy = rng.uniform(-0.35, 0.35, (NC//cell+2, NC//cell+2))
    cx = (gx // cell).astype(int); cy = (gy // cell).astype(int)
    # distance to jittered cell centre, wrapped
    px = (gx % cell) / cell - 0.5 - jx[cy, cx]
    py = (gy % cell) / cell - 0.5 - jy[cy, cx]
    d = np.sqrt(px*px + py*py)
    stone = np.clip(1.0 - d*1.9, 0, 1)**0.6
    val = 0.36 + stone*0.28
    per = rng.uniform(-0.05, 0.05, (NC//cell+2, NC//cell+2))
    val += per[cy, cx]
    Image.fromarray((np.clip(val,0,1)*255).astype(np.uint8), 'L').save(
        os.path.join(OUT, 'cobble_albedo.png'), optimize=True)
    print('cobble_albedo.png (1024)')
    save('cobble_grime.png', streaks(72, 0.30, beta=2.4))

    # -- floorboards: board stripes + along-grain streaks
    a = albedo_base(81, 0.07, beta=2.0)
    xx = np.arange(N)[None, :]
    board_w = N//8
    joint = ((xx % board_w) < 2).astype(float)
    rngb = np.random.default_rng(82)
    boards = np.repeat(rngb.uniform(-0.07, 0.07, N//board_w + 1), board_w)[:N]
    grain = fbm(83, 1.8, aniso=0.15)      # streaks along y (grain)
    a = a + boards[None, :N][0][None, :] * np.ones((N,1)) + (grain-0.5)*0.10 - joint*0.13
    save('planks_albedo.png', a)
    save('planks_grime.png', streaks(84, 0.35, beta=2.2))

    # -- shop floor tile: checker with wear
    a = albedo_base(91, 0.04, beta=3.0)
    tile = N//16
    check = (((np.arange(N)[:,None]//tile) + (np.arange(N)[None,:]//tile)) % 2).astype(float)
    seam = (((np.arange(N)[:,None] % tile) < 1) | ((np.arange(N)[None,:] % tile) < 1)).astype(float)
    a = a + check*0.10 - 0.05 - seam*0.12
    save('tile_albedo.png', a)
    save('tile_grime.png', streaks(92, 0.28, beta=2.6))

    total = sum(os.path.getsize(os.path.join(OUT, f))
                for f in os.listdir(OUT) if f.endswith('.png'))
    print(f'total {total//1024}KB')

if __name__ == '__main__':
    main()
