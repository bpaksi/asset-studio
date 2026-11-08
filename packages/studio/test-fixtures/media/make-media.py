#!/usr/bin/env python3
"""Regenerates the tiny committed fixture media in this folder.

One-off tool, not run by tests or CI. Needs Pillow and macOS `afconvert`.
Every image is lossless WebP made of flat blocks, so the files stay a few
hundred bytes and the pixels are exactly known. Layout (x, y, w, h):

  painting-stair.webp  1920x1080  base (30,60,120)
                       bar    (0,0,400,100)      (220,180,20)
                       block  (1500,800,400,260) (40,160,80)
  glow-stair.webp      1920x1080  gray 0, lit rectangle (1200,300,300,260) gray 200
  glow-stair-shifted.webp  same, but the lit rectangle sits at (200,700,300,260)
  foe-shade-dashboard.webp 1920x1080, foe-shade-ipad.webp 1640x2360
  portrait-narrator-angry.webp 720x900
  line.m4a  AAC in MP4, 1 s, 22050 Hz mono tone;  door.wav  0.2 s RIFF PCM16 mono 8000 Hz
"""
import math, os, struct, subprocess, tempfile, wave
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))


def img(name, size, base, rects=(), mode="RGB"):
    im = Image.new(mode, size, base)
    for (x, y, w, h), colour in rects:
        im.paste(colour, (x, y, x + w, y + h))
    im.save(os.path.join(here, name), "WEBP", lossless=True, quality=100, method=6)


img("painting-stair.webp", (1920, 1080), (30, 60, 120),
    [((0, 0, 400, 100), (220, 180, 20)), ((1500, 800, 400, 260), (40, 160, 80))])
img("glow-stair.webp", (1920, 1080), 0, [((1200, 300, 300, 260), 200)], "L")
img("glow-stair-shifted.webp", (1920, 1080), 0, [((200, 700, 300, 260), 200)], "L")
img("foe-shade-dashboard.webp", (1920, 1080), (90, 20, 20), [((100, 100, 500, 300), (200, 200, 60))])
img("foe-shade-ipad.webp", (1640, 2360), (20, 20, 90), [((100, 1800, 600, 400), (60, 200, 200))])
img("portrait-narrator-angry.webp", (720, 900), (120, 40, 40), [((60, 60, 200, 300), (240, 240, 240))])


def tone(path, rate, seconds, freq):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(
            struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / rate)))
            for i in range(int(rate * seconds))))


tone(os.path.join(here, "door.wav"), 8000, 0.2, 220)
with tempfile.TemporaryDirectory() as tmp:
    src = os.path.join(tmp, "line.wav")
    tone(src, 22050, 1.0, 330)
    subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", src, os.path.join(here, "line.m4a")], check=True)
