#!/usr/bin/env python3
"""Generate XHS cover images for Anthropic blog posts using Pillow."""
from PIL import Image, ImageDraw, ImageFont
import os, sys

FONT_PATH = "/System/Library/Fonts/PingFang.ttc"
W, H = 1080, 1440

def get_font(size, index=0):
    try:
        return ImageFont.truetype(FONT_PATH, size, index=index)
    except:
        return ImageFont.load_default()

def draw_rounded_rect(draw, xy, radius, fill):
    x1, y1, x2, y2 = xy
    draw.rectangle([x1+radius, y1, x2-radius, y2], fill=fill)
    draw.rectangle([x1, y1+radius, x2, y2-radius], fill=fill)
    draw.pieslice([x1, y1, x1+2*radius, y1+2*radius], 180, 270, fill=fill)
    draw.pieslice([x2-2*radius, y1, x2, y1+2*radius], 270, 360, fill=fill)
    draw.pieslice([x1, y2-2*radius, x1+2*radius, y2], 90, 180, fill=fill)
    draw.pieslice([x2-2*radius, y2-2*radius, x2, y2], 0, 90, fill=fill)

def wrap_text(text, font, max_width, draw):
    lines = []
    current = ""
    for ch in text:
        test = current + ch
        bbox = draw.textbbox((0,0), test, font=font)
        if bbox[2] - bbox[0] > max_width:
            lines.append(current)
            current = ch
        else:
            current = test
    if current:
        lines.append(current)
    return lines

def generate_cover(title, date, points, summary, output_path):
    img = Image.new('RGB', (W, H), '#0a0a2e')
    draw = ImageDraw.Draw(img)
    
    for y in range(H):
        r = int(10 + (y/H)*15)
        g = int(10 + (y/H)*10)
        b = int(46 + (y/H)*30)
        draw.line([(0, y), (W, y)], fill=(r, g, b))
    
    for x in range(0, W, 50):
        draw.line([(x, 0), (x, H)], fill=(60, 80, 140, 20), width=1)
    for y in range(0, H, 50):
        draw.line([(0, y), (W, y)], fill=(60, 80, 140, 20), width=1)
    
    draw_rounded_rect(draw, (70, 90, 380, 145), 25, '#ff6a00')
    badge_font = get_font(28)
    draw.text((90, 98), "🔬 Anthropic Research", font=badge_font, fill='#ffffff')
    
    date_font = get_font(30)
    draw.text((70, 180), date, font=date_font, fill=(180, 180, 220))
    
    title_font = get_font(58, index=0)
    title_lines = wrap_text(title, title_font, W - 160, draw)
    y_pos = 240
    for line in title_lines[:3]:
        draw.text((70, y_pos), line, font=title_font, fill='#ffffff')
        y_pos += 75
    
    for x in range(70, 600):
        ratio = (x - 70) / 530
        r = int(255 * (1 - ratio) + 236 * ratio)
        g = int(106 * (1 - ratio) + 72 * ratio)
        b = int(0 * (1 - ratio) + 153 * ratio)
        draw.line([(x, y_pos + 20), (x, y_pos + 24)], fill=(r, g, b))
    y_pos += 50
    
    point_font = get_font(34)
    for p in points:
        draw.text((70, y_pos), p, font=point_font, fill=(230, 230, 250))
        y_pos += 65
    
    draw.rectangle([0, 1040, W, H], fill=(15, 15, 50))
    
    summary_title_font = get_font(32)
    draw.text((70, 1080), "核心发现", font=summary_title_font, fill='#ff6a00')
    
    summary_font = get_font(26)
    summary_lines = wrap_text(summary, summary_font, W - 160, draw)
    sy = 1130
    for line in summary_lines[:6]:
        draw.text((70, sy), line, font=summary_font, fill=(170, 170, 200))
        sy += 40
    
    wm_font = get_font(22)
    draw.text((70, H - 50), "yoko lucky | 小红书技术博客", font=wm_font, fill=(120, 120, 160))
    
    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)
    img.save(output_path, 'PNG', quality=95)
    return output_path

if __name__ == "__main__":
    # Test
    generate_cover(
        title=sys.argv[1] if len(sys.argv) > 1 else "测试标题",
        date=sys.argv[2] if len(sys.argv) > 2 else "2026年3月24日",
        points=["📊 要点一", "💡 要点二", "🌍 要点三"],
        summary="这是一段测试摘要文字。",
        output_path="/tmp/openclaw/uploads/xhs_cover.png"
    )
    print("Cover generated")
