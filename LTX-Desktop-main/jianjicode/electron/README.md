# jianjicode 桌面应用打包指南

## 快速开始

### 1. 安装依赖

```bash
cd jianjicode
bun install
```

### 2. 开发模式运行

```bash
bun run electron:dev
```

### 3. 构建 Windows 安装包

```bash
bun run electron:build
```

构建完成后，安装包位于 `release/` 目录。

---

## 系统要求

### 最低配置
- Windows 10 (64-bit) 或更高版本
- 4 GB RAM
- 2 GB 可用磁盘空间

### 推荐配置
- Windows 10/11 (64-bit)
- 8 GB+ RAM
- SSD 固态硬盘

---

## 打包输出

构建完成后，`release/` 目录包含：

```
release/
├── jianjicode-0.1.0-setup.exe    # NSIS 安装包
└── ...
```

---

## 故障排除

### 问题: electron-builder 下载失败

解决方案：确保网络连接，或配置国内镜像：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

### 问题: 打包后无法运行

检查：
1. Windows 是否安装了必要的运行库 (Visual C++ Redistributable)
2. 杀毒软件是否拦截了应用

### 问题: 图标显示异常

将 `resources/icon.svg` 转换为 `resources/icon.ico`（256x256 PNG 格式）并放置在 `resources/icon.ico`。

---

## 注意事项

1. **AI 功能需要网络连接**：桌面应用调用 AI 服务需要访问互联网
2. **视频处理依赖 FFmpeg**：已内置，无需额外安装
3. **首次启动较慢**：Electron 应用冷启动需要加载大量 JS
