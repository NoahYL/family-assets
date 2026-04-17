"""
Family Assets 图标 v3。

设计：
- 圆角方块 + 蓝绿渐变背景（macOS Big Sur 风）
- 白色实心房子（家的象征，占画面 ~60%）
- 屋身内：左右两个圆形 avatar（柳 / 刘），分别用蓝、绿底色（与 UI 的 Badge 颜色呼应）
- avatar 下方：一条向右上的资产折线 + 箭头，深绿色
"""

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
RADIUS = int(SIZE * 0.225)

# 与 UI Badge 配色呼应
SKY = (14, 165, 233)      # sky-500   柳哥 Badge 蓝
EMERALD = (16, 185, 129)  # emerald-500 刘总 Badge 绿
DARK_GREEN = (4, 120, 87) # emerald-700 资产曲线

# --- 1. 垂直渐变背景 ---
grad = Image.new("RGB", (1, SIZE))
for y in range(SIZE):
    t = y / (SIZE - 1)
    r = int(SKY[0] * (1 - t) + EMERALD[0] * t)
    g = int(SKY[1] * (1 - t) + EMERALD[1] * t)
    b = int(SKY[2] * (1 - t) + EMERALD[2] * t)
    grad.putpixel((0, y), (r, g, b))
grad = grad.resize((SIZE, SIZE), Image.BICUBIC)

mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle(
    [0, 0, SIZE, SIZE], radius=RADIUS, fill=255
)
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)
WHITE = (255, 255, 255, 255)

# --- 2. 白色实心房子（放大占更多画面，给内容留足空间）---
cx = SIZE // 2
HOUSE_W = 760
HOUSE_H = 760
roof_h = int(HOUSE_H * 0.32)  # 屋顶略扁
top_y = (SIZE - HOUSE_H) // 2 - 20  # 略上移

# 屋顶
d.polygon(
    [
        (cx, top_y),
        (cx - HOUSE_W // 2, top_y + roof_h),
        (cx + HOUSE_W // 2, top_y + roof_h),
    ],
    fill=WHITE,
)
# 屋身
body_w = int(HOUSE_W * 0.82)
body_left = cx - body_w // 2
body_right = cx + body_w // 2
body_top_y = top_y + roof_h
body_bottom_y = top_y + HOUSE_H
d.rectangle(
    [body_left, body_top_y, body_right, body_bottom_y], fill=WHITE
)
body_h = body_bottom_y - body_top_y

# --- 3. 两个圆形 avatar（柳 / 刘）：放屋身上部，左右分开更宽 ---
avatar_r = 100
avatar_y = body_top_y + 130
left_x = cx - 175
right_x = cx + 175

FONT_PATH = "/System/Library/Fonts/STHeiti Medium.ttc"
font = ImageFont.truetype(FONT_PATH, size=125)

def draw_avatar(cx_, cy_, r, bg, char):
    d.ellipse([cx_ - r, cy_ - r, cx_ + r, cy_ + r], fill=bg)
    bbox = d.textbbox((0, 0), char, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = cx_ - tw // 2 - bbox[0]
    ty = cy_ - th // 2 - bbox[1]
    d.text((tx, ty), char, fill=WHITE, font=font)

draw_avatar(left_x,  avatar_y, avatar_r, SKY,     "柳")
draw_avatar(right_x, avatar_y, avatar_r, EMERALD, "刘")

# --- 4. 下方资产折线（占屋身下 40%，幅度明显）---
line_w = 40
bl_x = body_left + 70
br_x = body_right - 70
b_top = avatar_y + avatar_r + 70           # 曲线顶部（上升后终点）
b_bot = body_bottom_y - 80                 # 曲线底部（起点）
span_x = br_x - bl_x
span_y = b_bot - b_top                      # 正值，越大幅度越大

pts = [
    (bl_x,                        b_bot),                          # 起点（最低）
    (bl_x + int(span_x * 0.28),   b_bot - int(span_y * 0.15)),    # 小涨
    (bl_x + int(span_x * 0.48),   b_bot - int(span_y * 0.05)),    # 小回调
    (bl_x + int(span_x * 0.72),   b_bot - int(span_y * 0.70)),    # 大涨
    (br_x - 15,                   b_top),                          # 创新高（最高）
]
d.line(pts, fill=DARK_GREEN, width=line_w, joint="curve")

# 终点箭头：指向右上方，从折线末端延伸出来
ex, ey = pts[-1]
arrow = 58
d.polygon(
    [
        (ex - arrow, ey + int(arrow * 0.15)),
        (ex, ey - arrow),
        (ex + 10, ey + 10),
    ],
    fill=DARK_GREEN,
)

OUT = "src-tauri/app-icon.png"
img.save(OUT, "PNG")
print(f"✔ Generated {OUT} ({SIZE}x{SIZE})")
