# -*- coding: utf-8 -*-
# 词峰 logo 背景透明化 + 各尺寸导出
# 方案: 软键控——距白程度 <=8 视为背景(全透), >=45 视为主体(不透明), 之间线性过渡
# 主体颜色保持原样(浅色笔触不会被错误解混成半透明), 另出深色主题提亮版
#
# 注意(2026-10-20 品牌统一): 本脚本产出的 master 底部烘焙的是旧英文 WORDVERSE,
# 已不用于运行时。当前图标与启动门走 assets-brand/icons.py + logo-mark(纯山形,
# 英文由代码渲染)。保留本脚本仅用于从竖版印章原稿重新取图。
from PIL import Image

SRC = 'assets-brand/logo-source.jpg'
OUT = 'frontend/public'

im = Image.open(SRC).convert('RGB')
W, H = im.size
px = im.load()

T_LO, T_HI = 8, 45  # 白距阈值带

def white_dist(p):
    return 255 - min(p[0], p[1], p[2])

# 第一遍: 分类 + bbox
minx, miny, maxx, maxy = W, H, 0, 0
for y in range(H):
    for x in range(W):
        p = px[x, y]
        if min(p) < 247:  # 有一点非白就纳入主体范围
            if x < minx: minx = x
            if x > maxx: maxx = x
            if y < miny: miny = y
            if y > maxy: maxy = y

pad = 12
bbox = (max(0, minx - pad), max(0, miny - pad), min(W, maxx + 1 + pad), min(H, maxy + 1 + pad))

def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)

master = Image.new('RGBA', (W, H))
mp = master.load()
for y in range(H):
    for x in range(W):
        p = px[x, y]
        wd = 255 - min(p[0], p[1], p[2])
        if wd <= T_LO:
            mp[x, y] = (0, 0, 0, 0)
        else:
            a = int(round(255 * smoothstep((wd - T_LO) / float(T_HI - T_LO)))) if wd < T_HI else 255
            mp[x, y] = (p[0], p[1], p[2], a)
master = master.crop(bbox)

# 深色主题版: 主体色向白色提 42%(只动 a>0 的像素, alpha 不变)
dark = master.copy()
dp = dark.load()
for y in range(dark.height):
    for x in range(dark.width):
        r, g, b, a = dp[x, y]
        if a > 0:
            dp[x, y] = (
                int(round(r + (255 - r) * 0.42)),
                int(round(g + (255 - g) * 0.42)),
                int(round(b + (255 - b) * 0.42)),
                a,
            )

master.save(OUT + '/logo-master.png')
dark.save(OUT + '/logo-master-dark.png')
print('master:', master.size, ' dark:', dark.size)

# 方形图标: 透明画布内按 0.82 留边居中
def square(src, size, name, opaque_white=False):
    canvas = Image.new('RGBA', (size, size), (255, 255, 255, 255) if opaque_white else (0, 0, 0, 0))
    box = int(size * 0.82)
    s = min(box / src.width, box / src.height)
    w, h = max(1, int(src.width * s)), max(1, int(src.height * s))
    mark = src.resize((w, h), Image.LANCZOS)
    if opaque_white:
        # 苹果触摸图标不透明: 白底合成
        canvas.paste(mark, ((size - w) // 2, (size - h) // 2), mark)
    else:
        canvas.alpha_composite(mark, ((size - w) // 2, (size - h) // 2))
    canvas.save(OUT + '/' + name)
    print('导出', name, canvas.size)

square(master, 512, 'logo-512.png')
square(master, 192, 'logo-192.png')
square(master, 180, 'apple-touch-icon.png', opaque_white=True)
square(master, 48, 'logo-48.png')
square(master, 32, 'logo-32.png')
square(master, 16, 'logo-16.png')
