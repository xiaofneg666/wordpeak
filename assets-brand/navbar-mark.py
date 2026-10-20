# -*- coding: utf-8 -*-
# 词峰导航栏专用标:横构图品牌场景稿 → 白底转透明 + 亮/暗双版
# 源图 logo-source-nav.jpg(1254x1254 白底铅笔稿,墨迹 835x615 横构图):
#   右侧排线山坡 + 中左深色主峰 + 底部云雾质感带——与竖版印章 logo-source 同一
#   品牌世界的横向版,横构图适配导航栏横排锁字。
# 透明化与 process.py 同款软键控:白距 <=8 全透、>=45 不透明、之间 smoothstep;
# 亮版原色,暗版向白提 42%(仅动 a>0 像素)。导航、启动门、PWA 图标都只用
# 这个纯山形标;文字标(词峰 / WORDPEAK)由代码渲染,不再烘焙进图片。
from PIL import Image

SRC = 'assets-brand/logo-source-nav.jpg'
OUT = 'frontend/public'
T_LO, T_HI = 8, 45
PAD = 6

im = Image.open(SRC).convert('RGB')
W, H = im.size
px = im.load()

def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)

def white_dist(p):
    return 255 - min(p[0], p[1], p[2])

# 墨迹 bbox:白距 >25 才纳入(12~25 之间是外围浅雾,收进来在 34px 高度下
# 只会摊成一圈淡灰底,像按钮底板;核心景在阈值 25/40/60 下稳定为 833x613)
minx, miny, maxx, maxy = W, H, -1, -1
for y in range(H):
    for x in range(W):
        if white_dist(px[x, y]) > 25:
            minx, miny = min(minx, x), min(miny, y)
            maxx, maxy = max(maxx, x), max(maxy, y)
bbox = (max(0, minx - PAD), max(0, miny - PAD), min(W, maxx + 1 + PAD), min(H, maxy + 1 + PAD))

master = Image.new('RGBA', (W, H))
mp = master.load()
for y in range(H):
    for x in range(W):
        p = px[x, y]
        wd = white_dist(p)
        if wd <= T_LO:
            mp[x, y] = (0, 0, 0, 0)
        else:
            a = int(round(255 * smoothstep((wd - T_LO) / float(T_HI - T_LO)))) if wd < T_HI else 255
            mp[x, y] = (p[0], p[1], p[2], a)
master = master.crop(bbox)

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

master.save(OUT + '/logo-mark.png')
dark.save(OUT + '/logo-mark-dark.png')
print('导出 logo-mark:', master.size, f'宽高比 {master.width / master.height:.2f}')
print('导出 logo-mark-dark:', dark.size)
