"""Build the eight original Korean fascia masks used by the shared city draw."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def build():
    font_paths = [Path('C:/Windows/Fonts/malgunbd.ttf'),
                  Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc')]
    font_file = next(path for path in font_paths if path.is_file())
    face = ImageFont.truetype(str(font_file), 43)
    labels = ['라온약국', '솔빛서점', '항구제과', '한길식료품', '해온카페', '미루세탁', '수리공방', '바다상회']
    atlas = Image.new('L', (512, 512))
    draw = ImageDraw.Draw(atlas)
    for row, label in enumerate(labels):
        top = 64 * row
        # A horizontal baseline and contrasting brand symbols hold up at smaller mip levels.
        draw.line((10, top+55, 502, top+55), fill=108, width=2)
        if row == 0:
            draw.rectangle((40, top+10, 50, top+46), fill=255)
            draw.rectangle((27, top+23, 63, top+33), fill=255)
        elif row % 2:
            draw.polygon([(26,top+35),(43,top+11),(62,top+35),(46,top+29)],fill=240)
        else:
            draw.ellipse((27, top+13, 59, top+45), outline=240, width=7)
            draw.line((37, top+29, 65, top+29), fill=230, width=6)
        # Individually set letter positions to span a long physical fascia.
        for i, ch in enumerate(label):
            x = 106 + round(i * 365 / len(label))
            draw.text((x,top+29),ch,font=face,anchor='lm',fill=255)
    target=Path(__file__).resolve().parents[1]/'art/district-signs.webp'
    atlas.convert('RGB').save(target,lossless=True,method=6,exact=True)


if __name__=='__main__':
    build()
