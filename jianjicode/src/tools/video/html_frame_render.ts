import { randomUUID } from "node:crypto"
import { createHash } from "node:crypto"
import { join, resolve, dirname } from "node:path"
import { existsSync, readFileSync, statSync } from "node:fs"
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import {
  generateOperationId,
  generateClipId,
  type EditOperation,
} from "../../protocol/edit-operations.js"

// ================================================================
// 常量
// ================================================================

const RENDER_WORKER_PATH = join(dirname(new URL(import.meta.url).pathname), "render-worker.mjs");
const OUTPUTS_DIR = join(process.cwd(), "outputs");
const FRAME_CACHE_DIR = join(OUTPUTS_DIR, ".frame_cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_SIZE_MB = 500;
const WORKER_TIMEOUT_MS = 30_000;

// ================================================================
// 模板占位符 DSL
// ================================================================

const PLACEHOLDER_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-z]+))?(?:=([^}]+))?\}\}/g;

const BUILTIN_PARAMS = new Set(["title", "text", "image", "index"]);

export function substitutePlaceholders(html: string, values: Record<string, string>): string {
  return html.replace(PLACEHOLDER_RE, (match, name, _type, defaultVal) => {
    if (name in values && values[name] !== undefined && values[name] !== "") {
      return values[name];
    }
    if (defaultVal !== undefined) return defaultVal;
    return "";
  });
}

export function parseMediaMeta(html: string): { width: number; height: number } | null {
  const wMatch = html.match(/<meta\s+name="template:media-width"\s+content="(\d+)"\s*\/?>/i);
  const hMatch = html.match(/<meta\s+name="template:media-height"\s+content="(\d+)"\s*\/?>/i);
  if (wMatch && hMatch) return { width: parseInt(wMatch[1]), height: parseInt(hMatch[1]) };
  return null;
}

export function extractDefaultBackground(html: string): string {
  const match = html.match(/background(?:-color)?:\s*([#\w(),\s]+?);/i);
  return match?.[1] || "#000000";
}

export function parseResolutionFromPath(template: string): { width: number; height: number } | null {
  const m = template.match(/(\d{3,4})x(\d{3,4})/);
  if (m) return { width: parseInt(m[1]), height: parseInt(m[2]) };
  return null;
}

export function fallbackSVG(bg: string, width: number, height: number): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="${bg}"/></svg>`
  )}`;
}

// ================================================================
// 缓存
// ================================================================

export function frameCacheKey(template: string, frameData: Record<string, unknown>): string {
  return createHash("sha256")
    .update(template + JSON.stringify(frameData))
    .digest("hex")
    .slice(0, 16);
}

async function cleanExpiredCache(): Promise<void> {
  if (!existsSync(FRAME_CACHE_DIR)) return;

  const files = await readdir(FRAME_CACHE_DIR);
  const now = Date.now();
  let totalSize = 0;

  for (const file of files) {
    const st = await stat(join(FRAME_CACHE_DIR, file));
    totalSize += st.size;
    if (now - st.mtimeMs > CACHE_TTL_MS) {
      await unlink(join(FRAME_CACHE_DIR, file));
      totalSize -= st.size;
    }
  }

  if (totalSize > CACHE_MAX_SIZE_MB * 1024 * 1024) {
    const sorted = files
      .map((f) => {
        const st = statSync(join(FRAME_CACHE_DIR, f));
        return { name: f, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => a.mtime - b.mtime);

    for (const { name, size } of sorted) {
      if (totalSize <= CACHE_MAX_SIZE_MB * 1024 * 1024 * 0.8) break;
      await unlink(join(FRAME_CACHE_DIR, name));
      totalSize -= size;
    }
  }
}

// ================================================================
// 子进程通信
// ================================================================

interface WorkerInput {
  frames: Array<{ html: string; width: number; height: number; outputPath: string }>;
  outputDir: string;
}

interface WorkerOutput {
  success: boolean;
  frames: Array<{ index: number; path: string }>;
  errors?: Array<{ index: number; error: string }>;
  elapsed: number;
}

function spawnRenderWorker(input: WorkerInput): Promise<WorkerOutput> {
  return new Promise((resolve, reject) => {
    const nodePath = process.env.HTML_FRAME_NODE_PATH || "node";
    const proc = spawn(nodePath, [RENDER_WORKER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_PATH: `${process.env.NODE_PATH || ""};C:\\Program Files\\nodejs\\node_modules` },
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Render worker timeout (30s)"));
    }, WORKER_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("close", (code: number) => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Worker JSON parse error: ${stdout.slice(0, 200)}`));
        }
      } else {
        reject(new Error(`Worker exit ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Worker spawn failed: ${err.message}`));
    });

    // Send input via stdin
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

// ================================================================
// Path safety
// ================================================================

export function checkOutputPath(outputPath: string): string | null {
  const resolved = resolve(outputPath);
  const outputsRoot = resolve(OUTPUTS_DIR);
  if (!resolved.startsWith(outputsRoot)) {
    return `输出路径必须在 outputs 目录内: ${outputPath}`;
  }
  return null;
}

// ================================================================
// 工具定义
// ================================================================

const paramsSchema = z.object({
  template: z.string().describe("HTML模板路径（如 templates/1080x1920/image_default.html）或内联HTML字符串"),
  frames: z
    .array(
      z.object({
        title: z.string().optional().describe("帧标题"),
        text: z.string().describe("帧文字内容（解说词）"),
        image: z.string().optional().describe("背景图路径或URL"),
        duration: z.number().optional().describe("帧持续时长(秒)。不填则默认3秒"),
        custom: z.record(z.string(), z.string()).optional().describe("模板自定义参数"),
      })
    )
    .min(1)
    .max(100)
    .describe("帧数据数组"),
  resolution: z
    .enum(["1080x1920", "1920x1080", "1080x1080"])
    .optional()
    .describe("输出分辨率。不填则从模板路径自动解析"),
  output_dir: z
    .string()
    .optional()
    .describe("输出目录。默认: outputs/frames/<uuid>/"),
});

type HtmlFrameArgs = z.infer<typeof paramsSchema>;

export const HtmlFrameRenderTool = Tool.define("html_frame_render", {
  description:
    "生成带文字的视频帧/画面（标题卡/解说页/片头片尾）。输入HTML模板+文案+可选背景图，输出视频帧PNG序列",
  parameters: paramsSchema,
  usageTemplate: {
    json: {
      template: "templates/1080x1920/image_default.html",
      frames: [
        {
          title: "标题",
          text: "解说词内容",
          image: "{optional_bg_image}",
          duration: 4.2,
        },
      ],
      output_dir: "{output_dir}/frames/{session_id}",
    },
    constraints: [
      "先调tts获取音频时长，将duration作为帧展示时长，保证音画对齐",
    ],
  },
  execute: async (args: HtmlFrameArgs, ctx) => {
    // 1. 加载模板
    let templateHtml: string;
    let templateKey: string;

    if (args.template.includes("<html") || args.template.includes("<body")) {
      templateHtml = args.template;
      templateKey = "inline";
    } else {
      const templatePath = join(process.cwd(), args.template);
      if (!existsSync(templatePath)) {
        return {
          title: "模板未找到",
          metadata: { operation: "html_frame_render", error: true },
          output: `模板文件不存在: ${templatePath}`,
        };
      }
      templateHtml = readFileSync(templatePath, "utf-8");
      templateKey = args.template;
    }

    // 2. 解析分辨率
    const resParams = args.resolution
      ? parseResolutionFromPath(args.resolution)
      : parseResolutionFromPath(args.template);
    const frameWidth = resParams?.width || 1080;
    const frameHeight = resParams?.height || 1920;

    // 3. 输出目录
    const outputDir =
      args.output_dir || join(OUTPUTS_DIR, "frames", randomUUID().slice(0, 8));
    const pathErr = checkOutputPath(outputDir);
    if (pathErr) {
      return {
        title: "路径安全检查失败",
        metadata: { operation: "html_frame_render", error: true },
        output: pathErr,
      };
    }

    if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });

    // 4. 缓存清理
    await cleanExpiredCache();
    if (!existsSync(FRAME_CACHE_DIR)) await mkdir(FRAME_CACHE_DIR, { recursive: true });

    // 5. 处理每一帧的 HTML
    const defaultBg = extractDefaultBackground(templateHtml);
    const mediaMeta = parseMediaMeta(templateHtml);
    const bgWidth = mediaMeta?.width || frameWidth;
    const bgHeight = mediaMeta?.height || frameHeight;

    let cacheHits = 0;
    let cacheMisses = 0;
    const renderFrames: WorkerInput["frames"] = [];
    const resultPaths: string[] = [];
    const resultDurations: number[] = [];

    for (let i = 0; i < args.frames.length; i++) {
      const fd = args.frames[i];
      const outputPath = join(outputDir, `frame_${String(i + 1).padStart(4, "0")}.png`);

      // 构建替换值
      const values: Record<string, string> = {
        title: fd.title || "",
        text: fd.text,
        image: fd.image || fallbackSVG(defaultBg, bgWidth, bgHeight),
        ...(fd.custom || {}),
      };

      const substituted = substitutePlaceholders(templateHtml, values);

      // 缓存检查
      const cacheKey = frameCacheKey(templateKey + substituted, fd);
      const cachePath = join(FRAME_CACHE_DIR, `${cacheKey}.png`);

      if (existsSync(cachePath)) {
        cacheHits++;
        resultPaths.push(cachePath);
        resultDurations.push(fd.duration || 3.0);
        continue;
      }

      cacheMisses++;
      renderFrames.push({ html: substituted, width: frameWidth, height: frameHeight, outputPath: cachePath });
      resultPaths.push(cachePath);
      resultDurations.push(fd.duration || 3.0);
    }

    // 6. 调用渲染 Worker
    if (renderFrames.length > 0) {
      console.log(
        `[HtmlFrame] Rendering ${renderFrames.length}/${args.frames.length} frames ` +
          `(cache: ${cacheHits} hits, ${cacheMisses} misses)`
      );

      let workerResult: WorkerOutput;
      try {
        workerResult = await spawnRenderWorker({
          frames: renderFrames,
          outputDir: FRAME_CACHE_DIR,
        });
      } catch (err) {
        console.error(`[HtmlFrame] Worker failed: ${(err as Error).message}`);
        return {
          title: "帧渲染失败",
          metadata: {
            operation: "html_frame_render",
            error: true,
            error_message: (err as Error).message,
            cacheHits,
            cacheMisses,
          },
          output: `渲染子进程失败: ${(err as Error).message}\n` +
            `已缓存命中 ${cacheHits} 帧，渲染失败 ${renderFrames.length} 帧`,
        };
      }

      // 更新失败的帧的路径为 null
      if (workerResult.errors) {
        for (const e of workerResult.errors) {
          console.warn(`[HtmlFrame] Frame ${e.index} render error: ${e.error}`);
          resultPaths[e.index] = "";
        }
      }
    } else {
      console.log(`[HtmlFrame] All ${args.frames.length} frames cached`);
    }

    // 7. 拷贝缓存帧到输出目录
    const outputPaths: string[] = [];
    for (let i = 0; i < resultPaths.length; i++) {
      const cachePath = resultPaths[i];
      if (!cachePath) {
        outputPaths.push("");
        continue;
      }
      const destPath = join(outputDir, `frame_${String(i + 1).padStart(4, "0")}.png`);
      if (cachePath !== destPath) {
        const { copyFile } = await import("node:fs/promises");
        await copyFile(cachePath, destPath);
      }
      outputPaths.push(destPath);
    }

    const totalDuration = resultDurations.reduce((a, b) => a + b, 0);

    console.log(
      `[HtmlFrame] Done: ${outputPaths.filter(Boolean).length}/${args.frames.length} frames, ` +
        `total duration: ${totalDuration.toFixed(1)}s`
    );

    const editOperations: EditOperation[] = outputPaths.filter(Boolean).map((p, i) => ({
      operationId: generateOperationId(),
      undoable: true,
      type: "add_clip" as const,
      clipId: generateClipId(),
      asset: {
        url: p,
        path: p,
        type: "image" as const,
      },
      trackKind: "video",
      trackName: "视频轨道",
      startTime: resultDurations.slice(0, i).reduce((a, b) => a + b, 0),
      duration: resultDurations[i] || 3,
      metadata: {
        toolName: "html_frame_render",
        description: `帧 ${i + 1}/${args.frames.length}: ${args.frames[i]?.title || ""}`,
        timestamp: Date.now(),
      },
    }))

    return {
      title: `帧渲染完成 (${outputPaths.filter(Boolean).length} 帧)`,
      metadata: {
        operation: "html_frame_render",
        success: true,
      undoable: true,
        template: templateKey,
        frameCount: args.frames.length,
        totalDuration,
        cacheHits,
        cacheMisses,
        outputPaths,
      },
      output: `帧渲染完成\n` +
        `模板: ${templateKey}\n` +
        `帧数: ${args.frames.length}\n` +
        `总时长: ${totalDuration.toFixed(1)} 秒\n` +
        `缓存命中: ${cacheHits}, 渲染: ${cacheMisses}\n` +
        `输出目录: ${outputDir}`,
      editOperations,
    };
  },
});
