#!/usr/bin/env python3
"""
Remove fake AI checkerboard transparency from PNG logos.
Flood-fills studio background (near black/white/gray, low chroma) from image edges,
then clears interior checkerboard islands (e.g. between propeller blades).
"""
from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image

# Tunables
CHROMA_STRICT = 28
CHROMA_RELAXED = 38
LUM_WHITE = 205
LUM_BLACK = 52
LUM_GRAY_LO = 88
LUM_GRAY_HI = 175
ISLAND_MIN_BG_NEIGHBORS = 5  # of 8


def chroma(r: int, g: int, b: int) -> int:
    return max(r, g, b) - min(r, g, b)


def lum(r: int, g: int, b: int) -> float:
    return (r + g + b) / 3.0


def is_white_bg(r: int, g: int, b: int) -> bool:
    return chroma(r, g, b) <= CHROMA_STRICT and lum(r, g, b) >= LUM_WHITE


def is_black_bg(r: int, g: int, b: int) -> bool:
    return chroma(r, g, b) <= CHROMA_STRICT and lum(r, g, b) <= LUM_BLACK


def is_relaxed_bg(r: int, g: int, b: int) -> bool:
    c = chroma(r, g, b)
    if c > CHROMA_RELAXED:
        return False
    l = lum(r, g, b)
    if l >= LUM_WHITE - 15:
        return True
    if l <= LUM_BLACK + 12:
        return True
    return LUM_GRAY_LO <= l <= LUM_GRAY_HI and c <= 14


def can_seed(r: int, g: int, b: int, flat, w: int, h: int, x: int, y: int) -> bool:
    if is_white_bg(r, g, b):
        return True
    if is_black_bg(r, g, b) and checkerboard_hint(flat, w, h, x, y):
        return True
    return checkerboard_hint(flat, w, h, x, y) and is_relaxed_bg(r, g, b)


def can_expand(r: int, g: int, b: int, flat, w: int, h: int, x: int, y: int) -> bool:
    if checkerboard_hint(flat, w, h, x, y) and is_relaxed_bg(r, g, b):
        return True
    # Only grow through white/gray studio tones — not solid black subject parts
    if is_white_bg(r, g, b):
        return True
    c = chroma(r, g, b)
    if c > CHROMA_RELAXED:
        return False
    l = lum(r, g, b)
    return LUM_GRAY_LO <= l <= LUM_GRAY_HI and c <= 14


def checkerboard_hint(rgb: list[tuple[int, int, int, int]], w: int, h: int, x: int, y: int) -> bool:
    """True when local neighborhood looks like a B/W checker tile."""
    r, g, b, _ = rgb[y * w + x]
    if chroma(r, g, b) > CHROMA_RELAXED:
        return False
    hits = 0
    for step in (8, 16, 32, 64):
        for dx, dy in ((step, 0), (0, step), (step, step)):
            x2, y2 = x + dx, y + dy
            if x2 >= w or y2 >= h:
                continue
            r2, g2, b2, _ = rgb[y2 * w + x2]
            if chroma(r2, g2, b2) > CHROMA_RELAXED:
                continue
            if abs(lum(r, g, b) - lum(r2, g2, b2)) >= 110:
                hits += 1
    return hits >= 2


def flood_background(w: int, h: int, flat: list[tuple[int, int, int, int]]) -> bytearray:
  bg = bytearray(w * h)
  q: deque[tuple[int, int]] = deque()

  def try_seed(x: int, y: int) -> None:
    i = y * w + x
    r, g, b, _ = flat[i]
    if can_seed(r, g, b, flat, w, h, x, y):
      bg[i] = 1
      q.append((x, y))

  for x in range(w):
    try_seed(x, 0)
    try_seed(x, h - 1)
  for y in range(1, h - 1):
    try_seed(0, y)
    try_seed(w - 1, y)

  while q:
    x, y = q.popleft()
    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
      if nx < 0 or ny < 0 or nx >= w or ny >= h:
        continue
      i = ny * w + nx
      if bg[i]:
        continue
      r, g, b, _ = flat[i]
      if can_expand(r, g, b, flat, w, h, nx, ny):
        bg[i] = 1
        q.append((nx, ny))

  # Black checker tiles touching known background (not solid black subject)
  changed = True
  while changed:
    changed = False
    for y in range(h):
      for x in range(w):
        i = y * w + x
        if bg[i]:
          continue
        r, g, b, _ = flat[i]
        if not is_black_bg(r, g, b) or not checkerboard_hint(flat, w, h, x, y):
          continue
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
          if 0 <= nx < w and 0 <= ny < h and bg[ny * w + nx]:
            bg[i] = 1
            changed = True
            break

  # Interior islands (propeller gaps, etc.)
  changed = True
  while changed:
    changed = False
    for y in range(h):
      for x in range(w):
        i = y * w + x
        if bg[i]:
          continue
        r, g, b, _ = flat[i]
        if not is_white_bg(r, g, b) and not (
          checkerboard_hint(flat, w, h, x, y) and is_relaxed_bg(r, g, b)
        ):
          continue
        n_bg = 0
        for dx in (-1, 0, 1):
          for dy in (-1, 0, 1):
            if dx == 0 and dy == 0:
              continue
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and bg[ny * w + nx]:
              n_bg += 1
        if n_bg >= ISLAND_MIN_BG_NEIGHBORS:
          bg[i] = 1
          changed = True

  return bg


def cleanup_trapped_studio(
    w: int, h: int, flat: list[tuple[int, int, int, int]], bg: bytearray
) -> None:
  """Remove studio/checkerboard pixels trapped between subject shapes."""
  changed = True
  passes = 0
  while changed and passes < 24:
    changed = False
    passes += 1
    for y in range(h):
      for x in range(w):
        i = y * w + x
        if bg[i]:
          continue
        r, g, b, _ = flat[i]
        if not (is_white_bg(r, g, b) or (checkerboard_hint(flat, w, h, x, y) and is_relaxed_bg(r, g, b))):
          continue

        bg_n = colorful_n = 0
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
          if nx < 0 or ny < 0 or nx >= w or ny >= h:
            continue
          j = ny * w + nx
          if bg[j]:
            bg_n += 1
            continue
          r2, g2, b2, _ = flat[j]
          if chroma(r2, g2, b2) > 42:
            colorful_n += 1

        if (bg_n >= 1 and colorful_n >= 1) or bg_n >= 2 or (
          colorful_n >= 2 and is_white_bg(r, g, b) and checkerboard_hint(flat, w, h, x, y)
        ):
          bg[i] = 1
          changed = True


def cleanup_halos(
    w: int, h: int, flat: list[tuple[int, int, int, int]], bg: bytearray
) -> None:
  """Drop pale fringe pixels bordering transparency."""
  for y in range(h):
    for x in range(w):
      i = y * w + x
      if bg[i]:
        continue
      r, g, b, _ = flat[i]
      if chroma(r, g, b) > 40:
        continue
      if lum(r, g, b) < 220:
        continue
      adj_bg = 0
      for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
          if dx == 0 and dy == 0:
            continue
          nx, ny = x + dx, y + dy
          if 0 <= nx < w and 0 <= ny < h and bg[ny * w + nx]:
            adj_bg += 1
      if adj_bg >= 2:
        bg[i] = 1


def feather_edges(
    w: int, h: int, flat: list[tuple[int, int, int, int]], bg: bytearray
) -> list[tuple[int, int, int, int]]:
  out = list(flat)
  for y in range(h):
    for x in range(w):
      i = y * w + x
      if bg[i]:
        out[i] = (flat[i][0], flat[i][1], flat[i][2], 0)
        continue

      r, g, b, _ = flat[i]
      c = chroma(r, g, b)
      adj_bg = 0
      for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
          if dx == 0 and dy == 0:
            continue
          nx, ny = x + dx, y + dy
          if 0 <= nx < w and 0 <= ny < h and bg[ny * w + nx]:
            adj_bg += 1

      if adj_bg == 0:
        out[i] = (r, g, b, 255)
        continue

      # Soften halos from anti-aliased checkerboard edges
      if c < 55 and adj_bg >= 2:
        alpha = max(0, min(255, int(c * 4.5)))
      elif c < 80 and adj_bg >= 1:
        alpha = max(64, min(255, int(255 - adj_bg * 18)))
      else:
        alpha = 255
      out[i] = (r, g, b, alpha)

  return out


def fill_subject_holes(
    w: int, h: int, flat: list[tuple[int, int, int, int]]
) -> list[tuple[int, int, int, int]]:
  """Fill tiny transparent gaps fully enclosed by opaque subject pixels."""
  data = list(flat)
  changed = True
  passes = 0
  while changed and passes < 8:
    changed = False
    passes += 1
    for y in range(h):
      for x in range(w):
        i = y * w + x
        if data[i][3] > 24:
          continue
        opaque: list[tuple[int, int, int, int]] = []
        for dx in (-1, 0, 1):
          for dy in (-1, 0, 1):
            if dx == 0 and dy == 0:
              continue
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
              continue
            j = ny * w + nx
            r, g, b, a = data[j]
            if a > 200 and not is_white_bg(r, g, b):
              opaque.append(data[j])
        if len(opaque) < 4:
          continue
        r = sum(c[0] for c in opaque) // len(opaque)
        g = sum(c[1] for c in opaque) // len(opaque)
        b = sum(c[2] for c in opaque) // len(opaque)
        data[i] = (r, g, b, 255)
        changed = True
  return data


def process(path: Path, out_path: Path | None = None) -> Path:
  img = Image.open(path).convert("RGBA")
  w, h = img.size
  flat = list(img.getdata())

  # Flatten onto opaque RGB for analysis (ignore broken prior alpha)
  flat = [(r, g, b, 255) for r, g, b, _ in flat]

  bg = flood_background(w, h, flat)
  cleanup_trapped_studio(w, h, flat, bg)
  cleanup_halos(w, h, flat, bg)
  result = feather_edges(w, h, flat, bg)
  result = fill_subject_holes(w, h, result)

  transparent = sum(1 for *_, a in result if a < 16)
  opaque = sum(1 for *_, a in result if a > 240)
  print(
    f"{path.name}: {w}x{h} → transparent {transparent / (w * h) * 100:.1f}%, "
    f"opaque {opaque / (w * h) * 100:.1f}%"
  )

  out = out_path or path
  out.parent.mkdir(parents=True, exist_ok=True)
  out_img = Image.new("RGBA", (w, h))
  out_img.putdata(result)
  out_img.save(out, optimize=True)
  return out


def main() -> None:
  root = Path(__file__).resolve().parents[1]
  targets = sys.argv[1:] or [
    str(root / "public" / "logo.png"),
    str(root / "public" / "favicon.png"),
  ]

  for t in targets:
    p = Path(t)
    if not p.exists():
      print(f"skip missing: {p}")
      continue
    process(p)

  # Keep dist build in sync when present
  for name in ("logo.png", "favicon.png"):
    src = root / "public" / name
    dst = root / "dist" / name
    if src.exists() and (root / "dist").is_dir():
      process(src, dst)


if __name__ == "__main__":
  main()
