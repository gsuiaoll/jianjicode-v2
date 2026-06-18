---
name: manimgl-animation
description: ManimGL 数学动画制作 — 从零编写 Python 动画代码并渲染。适用：数学可视化、3D 演示、概念动画、知识讲解视频。
category: create
tags: [manimgl, animation, math, python, education, video-generation]
created: 2026-06-19
---

# ManimGL 动画制作

## 你拥有的能力

作为 OpenCode agent，你**自己就能写代码并渲染**：
- 用 `Write` 工具写 ManimGL Python 脚本
- 用 `Bash` 工具运行 manimgl 渲染
- 用 `Read` 工具查看输出的视频帧
- 观看 → 发现问题 → 修改代码 → 重新渲染（迭代循环）

不需要任何外部工具或子 agent。

## 渲染命令

```bash
# 渲染 Python 脚本（从 python/manim_templates/ 运行）
cd python/manim_templates
manimgl scenes/custom/my_scene.py MyScene -ow

# 或用 python 直接运行
python manimgl_render.py scenes/custom/my_scene.py

# 环境变量控制质量:
# MANIM_QUALITY=480p|720p|1080p (默认 480p 预览)
# MANIM_PYTHON=/path/to/python (Python 路径)
```

## 代码模板

```python
#!/usr/bin/env python3
from manimlib import *

class DemoScene(Scene):
    def construct(self):
        # 分辨率设置
        config.pixel_width = 1920
        config.pixel_height = 1080
        
        # 设置相机宽度（横屏 9，竖屏 7）
        self.camera.frame.set_width(9)
        
        # ── 动画内容 ──
        circle = Circle(radius=1, color=BLUE)
        self.play(ShowCreation(circle))
        self.wait(0.5)
        
        text = Text("Hello ManimGL", font="Microsoft YaHei", font_size=48)
        self.play(Write(text))
        self.wait(1)

if __name__ == "__main__":
    from manimlib import main
    main()
```

## 关键经验（踩过的坑）

### 导入与基础
- 使用 ManimGL v1.7.2，导入用 `from manimlib import *`，不是 `manim`
- 继承 `Scene`，不是 `ThreeDScene`
- 文件头必须有 `#!/usr/bin/env python3`，所有 import 写在文件头
- **不要使用 emoji** — Windows GBK 编码会崩溃
- 用 `config.pixel_width/pixel_height` 设置分辨率
- 横屏 `1920x1080 + camera.set_width(9)`，竖屏 `1080x1920 + camera.set_width(7)`

### 中英文混排
- **LaTeX (`Tex()`) 不支持中文**，CJK 字符导致 LaTeX 编译失败
- 中文用 `Text()`，数学公式用 `Tex()`，分别创建后用 `VGroup()` 组合
- `fix_in_frame()` 的混排文字每个组件单独调用
- **`fix_in_frame()` 相机缩放时产生视觉撕裂**：缩放前提前 FadeOut 固定文字

### 数学公式排版
- 长公式必须拆分为多行（独立 Tex 对象 + VGroup），不依赖 Manim 自动换行
- 标题和公式至少 28-32px，关键定理公式至少 36-38px
- 分行 Tex 之间用 `buff=0.35` 行间距
- LaTeX 命令：`\mathrm` / `\operatorname` / `\text` 后紧跟数学语法时，优先用 `\mathrm{Word}`

### 动画 API
| 操作 | API |
|------|-----|
| 创建/显示 | `ShowCreation()`（不是 Create），`Write()`，`FadeIn/Out()` |
| 变形 | `Transform()`，`ReplacementTransform()` |
| 强调 | `GrowFromCenter()`，`Flash()`，`Indicate()` |
| 对象 | `Tex()`, `Text()`, `Circle()`, `Square()`, `VGroup()`, `Axes()`, `Dot()`, `Line()` |
| 着色 | `set_color()`, `set_fill()`, `set_stroke()`, `set_color_by_gradient()` |

### 特效与进阶
| API | 说明 |
|-----|------|
| `Broadcast(mob, distance=5, vector=UP)` | 冲击波扩散 |
| `FlashyFadeIn(mob)` | 带放大+高光的淡入 |
| `ApplyWave(mob, direction, amplitude)` | 波浪变形 |
| `TracedPath(mob.get_center)` | 跟踪点画平滑路径 |
| `TracingTail(mob, time_traced=0.8)` | 渐变描边尾部渐隐 |
| `get_colormap_list(n, "viridis")` | 科学配色表（viridis/magma/plasma/turbo） |
| `tex.anti_alias_width = 2.0` | 文字更锐利 |
| `interpolate_color_by_hsl(start, end, alpha)` | HSL 插值，比 RGB 鲜艳 |

### 镜头感与缓动
- 缓动：`rush_into`（先快后慢）、`rush_from`（先慢后快）、`running_start(pull=-0.5)`（先后退再前进）、`overshoot(pull=1.2)`（超目标回弹）
- 用法：`self.play(camera.frame.animate.set_width(28), rate_func=rush_into, run_time=3.0)`
- 3D 视角：`self.camera.frame.reorient(theta_degrees=-15, phi_degrees=65)`
- 圆形场景：`cam_width >= radius * 3.0~3.6` 留边距
- GlowDot 点大小需随相机动态调整：`dot_radius = cam_width * (24 + cam_width * 0.02) / 1920`

### 开场钩子
- **视频前 3 秒展示最终效果预览帧（teaser）**，让观众立刻知道要看什么，避免开场无画面

## 能力边界（不存在，勿尝试）
- ❌ 无 motion blur、无音频 API、无粒子物理
- ❌ `glow_factor` 是 static uniform，不支持 per-frame 动画
- ❌ `TracedPath` 只跟踪单个点，不能跟踪整个点云
- ❌ ManimGL 不能做写实 3D 渲染、角色动画、物理模拟、真人视频

## 字幕
**不要在 ManimGL 中用 `Text()` 渲染字幕**。后期用 FFmpeg ASS 合成：
1. `tts` 工具生成语音
2. `merge_audio` 合入视频
3. `video_subtitle` 添加字幕

## 工作流程（你必须遵守）

### Step 1: 理解需求
理解用户想表达的数学概念或视觉效果，提取参数。

### Step 2: 创建场景代码
用 `Write` 工具创建 `python/manim_templates/scenes/custom/<name>.py`，包含完整可运行代码。

### Step 3: 渲染预览
```bash
cd python/manim_templates
manimgl scenes/custom/<name>.py <SceneClassName> -ow --quality=480p
```
渲染时间：简单场景 < 30s，复杂场景 1-3 分钟。

### Step 4: 观看评审
观看渲染出的视频。对比用户需求，列出差异和改进点。关键检查项：
- 公式是否清晰可读（字号够大？位置不重叠？）
- 动画节奏是否舒适（不要太快或太慢）
- 颜色方案是否和谐
- 画面元素是否有重叠/遮挡

### Step 5: 迭代修正
如需调整 → 用 `Edit` 修改代码 → 重新渲染（Step 3）。**最多迭代 2 轮**。

### Step 6: 高清出片
确认效果后，用 720p/1080p 渲染最终版本：
```bash
manimgl scenes/custom/<name>.py <SceneClassName> -ow --quality=720p
```

### Step 7: 配音字幕（可选）
- `tts` → `merge_audio` → `video_subtitle`
- 旁白语速匹配动画节奏（优先调 silence gap，而非改动画 wait）
- `auto_fit_duration`：检测空白段，裁剪+变速匹配 TTS 时长

## 错误自愈

| 错误类型 | 含义 | 处理 |
|---------|------|------|
| `param_error` | 参数不合法 | 调整参数后重试（最多 2 次） |
| `env_error` | 环境问题（缺 FFmpeg/Python） | 告知用户需管理员介入 |
| `timeout_error` | 渲染超时 | 降低画质或简化参数 |
| LaTeX 编译错误 | 公式语法问题 | 检查 LaTeX 命令，拆分长公式 |

## 完整 API 参考
同目录下 `MANIM_GUIDE.md` 包含 200+ 行完整 API 文档和常见错误速查。在遇到不确定的 API 时先读取该文件。
