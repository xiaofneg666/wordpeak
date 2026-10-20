# -*- coding: utf-8 -*-
# 词峰 WORDPEAK 图标导出:只保留山形标,不再把文字烘焙进图标
# 源: frontend/public/logo-mark-dark.png(浅色铅笔山景,透明底)
# 底色: #08080d,与 PWA theme_color / 导航深色底一致
# 16/32: 先缩到目标 4 倍再阈值+膨胀成实心剪影——原图细铅笔线在 16px 会糊成灰雾
# 192/512/180: 保留原图笔触
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'frontend/public/logo-mark-dark.png'
OUT = ROOT / 'frontend/public'
BG = (8, 8, 13, 255)          # #08080d
INK = (236, 232, 222, 255)    # 暖白,暗底可读

src = Image.open(SRC).convert('RGBA')


def fit(mark, size, ratio):
    canvas = Image.new('RGBA', (size, size), BG)
    box = int(size * ratio)
    s = min(box / mark.width, box / mark.height)
    w, h = max(1, round(mark.width * s)), max(1, round(mark.height * s))
    mark = mark.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(mark, ((size - w) // 2, (size - h) // 2))
    return canvas


def silhouette(size):
    # 目标尺寸 4 倍工作分辨率:阈值去掉浅雾,膨胀把断续的铅笔线连成山形
    work_h = size * 4
    work_w = round(src.width * work_h / src.height)
    alpha = src.resize((work_w, work_h), Image.LANCZOS).getchannel('A')
    alpha = alpha.point(lambda v: 255 if v > 38 else 0).filter(ImageFilter.MaxFilter(3))
    ink = Image.new('RGBA', (work_w, work_h), INK)
    ink.putalpha(alpha)
    return ink


for size in (16, 32):
    icon = fit(silhouette(size), size, 0.88)
    icon.save(OUT / f'logo-{size}.png')
for size in (192, 512):
    icon = fit(src, size, 0.80)
    icon.save(OUT / f'logo-{size}.png')
icon = fit(src, 180, 0.78)
icon.save(OUT / 'apple-touch-icon.png')

print('导出图标:', ', '.join(f'logo-{s}.png' for s in (16, 32, 192, 512)), ', apple-touch-icon.png')
