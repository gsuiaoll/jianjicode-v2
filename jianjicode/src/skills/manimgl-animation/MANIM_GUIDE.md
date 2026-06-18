# ManimGL 视频制作实战指南

CC 生成 ManimGL 代码时 **必须遵守** 以下规范。这些是经过多个实战项目（质数螺旋、质数球坐标、四面体球）验证的踩坑经验。

---

## 一、渲染命令

| 场景 | 命令 |
|------|------|
| 横屏 16:9 (1920x1080) | `manimgl scene.py ClassName -w --hd` |
| 竖屏 9:16 (1080x1920) | `manimgl scene.py ClassName -w -r 1080x1920` |

代码中设置分辨率：
```python
config.pixel_width = 1920   # 横屏
config.pixel_height = 1080

# 竖屏
config.pixel_width = 1080
config.pixel_height = 1920
```

---

## 二、摄像机控制（产生镜头感的关键）

```python
# 画面宽度
self.camera.frame.set_width(9)   # 横屏
self.camera.frame.set_width(7)   # 竖屏

# 3D 视角
self.camera.frame.reorient(theta_degrees=-15, phi_degrees=65)

# 缓动动画 — 比 smooth 更有镜头感
self.play(self.camera.frame.animate.rush_into(new_position))
self.play(self.camera.frame.animate.rush_from(old_position))
```

缓动类型: `rush_into`, `rush_from`, `running_start`, `overshoot`

---

## 三、fix_in_frame 限制（重要！）

```python
text.fix_in_frame()  # 固定在屏幕空间，不随相机移动/缩放
```

**关键限制**: 相机缩放 >5x 时，fix_in_frame 纹理严重退化（锯齿/模糊）。
**解决**: 大缩放前用 FadeOut 移除 fix_in_frame 元素，或改用 FFmpeg ASS 在后期叠加文字。

---

## 四、拖尾效果

```python
from manimlib.utils.rate_functions import there_and_back

# TracedPath — 跟踪单点轨迹
trail = TracedPath(dot.get_center, stroke_width=2, stroke_opacity=0.6)

# TracingTail — 渐变描边尾部渐隐
TracingTail(mobject, time_traced=0.8, stroke_width=4, stroke_opacity=0.7)
```

---

## 五、色彩工具

```python
from manimlib.utils.color import get_colormap_list

colors = get_colormap_list(n, "viridis")     # 科学配色表
mob.set_color_by_gradient(color1, color2)     # 渐变着色
```

可用色表: viridis, plasma, inferno, magma, cividis, turbo

---

## 六、隐藏特效

| 效果 | API |
|------|-----|
| 冲击波扩散 | `Broadcast(mob)` |
| 放大高亮淡入 | `FlashyFadeIn(mob)` |
| 波浪变形 | `ApplyWave(mob)` |
| 辉光点 | `GlowDot(point, radius=0.05, glow_factor=4.0, color=WHITE)` |

完整 API 参考: `jianjicode/python/manim_templates/HIDDEN_FEATURES.md`

---

## 七、字幕：必须用 ASS，禁止 SRT

### 为什么
1. FFmpeg drawtext 不支持 CJK（中文显示为豆腐块）
2. SRT 没有 PlayRes 头，libass 默认 384x288 坐标系导致字幕定位错乱

### ASS 文件结构
```ini
[Script Info]
ScriptType: v4.00+
PlayResX: 1920     # 横屏 1920, 竖屏 1080
PlayResY: 1080     # 横屏 1080, 竖屏 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, ...
Style: Default,Noto Sans SC,64,&H00FFFFFF,&H000000FF,...

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:04.00,Default,,0,0,0,,字幕文本
```

字体用 `Noto Sans SC` 或 `Microsoft YaHei`（用字体名，不写路径）。

### Alignment 和 MarginV

| Alignment | 位置 | MarginV 含义 |
|-----------|------|-------------|
| 2 | 底部居中 | 距底部距离 |
| 8 | 顶部居中 | 距顶部距离 |

竖屏字幕要放画面下 1/3 处（避开底部 UI），MarginV 起点约 280。

### FFmpeg 烧录
```bash
ffmpeg -i video.mp4 -vf "ass='path/to/subs.ass'" -c:a copy output.mp4
```

---

## 八、横屏 → 竖屏适配

竖屏不能直接复用横屏场景，必须创建独立场景文件。

| 项目 | 横屏值 | 竖屏值 |
|------|--------|--------|
| camera width | 9 | 7 |
| font_size | 横屏基准 | ≈ 横屏 × 0.56 |
| PlayResX | 1920 | 1080 |
| PlayResY | 1080 | 1920 |
| MarginV (字幕) | 80 | 280~760 (需目视微调) |

---

## 九、TTS + BGM 流水线

```
1. edge_tts 逐句合成旁白 (zh-CN-XiaoxiaoNeural)
2. 句子间插入静音间隙 (GAPS 数组)
3. concat 所有音频片段
4. BGM 截取到视频时长 + 淡入淡出
5. BGM 降音量 (-20dB) + 旁白混音
6. 视频 + 混音合并
7. ASS 字幕烧录
```

GAPS[i] = 第 i 句**之后**的静音时长（秒）。

---

## 十、常见错误速查

| 问题 | 原因 | 解决 |
|------|------|------|
| 中文豆腐块 | drawtext 不支持 CJK | 用 ASS + libass |
| 字幕位置错乱 | SRT 无 PlayRes 头 | 用 ASS 显式声明分辨率 |
| fix_in_frame 模糊 | 相机缩放 >5x | 大缩放前 FadeOut |
| 两个 -filter_complex 后一个失效 | FFmpeg 只认最后一个 | 合并到一个 filter_complex |
| 竖屏文字溢出 | 横屏 font_size 直接复用 | 独立竖屏场景，字体 ×0.56 |
| emoji/中文 crash | Windows GBK 编码 | print 用纯英文，中文用 Text() |

---

## 十一、代码模板

```python
#!/usr/bin/env python3
from manimlib import *

class DemoScene(Scene):
    def construct(self):
        # 横屏设置
        config.pixel_width = 1920
        config.pixel_height = 1080
        self.camera.frame.set_width(9)

        # 动画逻辑
        title = Text("标题", font="Microsoft YaHei", font_size=48)
        self.play(Write(title))
        self.wait(1.0)
        self.play(FadeOut(title))
        self.wait(0.5)

if __name__ == "__main__":
    from manimlib import main
    main()
```

---

## 环境依赖

| 工具 | 版本 | 用途 |
|------|------|------|
| ManimGL | ≥ 1.7.2 | 动画渲染 |
| Python | ≥ 3.9 | 运行环境 |
| FFmpeg | ≥ 8.0（需含 libass） | 视频编码、字幕烧录 |
| edge-tts | 最新 | TTS 语音合成 |
