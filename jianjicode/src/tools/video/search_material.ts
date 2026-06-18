import { randomUUID } from "node:crypto"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import { probeMetadata } from "../../lib/ffmpeg-utils.js"
import {
  generateOperationId,
  generateClipId,
  type EditOperation,
} from "../../protocol/edit-operations.js"

// ================================================================
// Types
// ================================================================

interface MaterialInfo {
  url: string
  duration: number
  width: number
  height: number
  provider: string
}

interface MaterialSearchOptions {
  minDuration: number
  maxDuration: number
  orientation: "portrait" | "landscape"
  resolution: "720p" | "1080p" | "4K"
}

interface DownloadedMaterial {
  path: string
  url: string
  duration: number
  fps: number
  width: number
  height: number
  provider: string
  tags: string[]
}

const RESOLUTION_SPEC: Record<string, { w: number; h: number }> = {
  "720p": { w: 1280, h: 720 },
  "1080p": { w: 1920, h: 1080 },
  "4K": { w: 3840, h: 2160 },
}

// ================================================================
// HTTP helpers
// ================================================================

async function fetchWithRetry(url: string, init: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      const res = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) return res
      if (res.status === 429 && i < retries) {
        await sleep(2000 * (i + 1))
        continue
      }
      if (i < retries) {
        await sleep(1000 * (i + 1))
        continue
      }
      return res
    } catch (err) {
      if (i === retries) throw err
      await sleep(1000 * (i + 1))
    }
  }
  throw new Error("unreachable")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function urlToCacheKey(url: string): string {
  const base = url.split("?")[0]
  return createHash("md5").update(base).digest("hex").slice(0, 16)
}

// ================================================================
// Pexels API
// ================================================================

async function searchPexels(keyword: string, opts: MaterialSearchOptions): Promise<MaterialInfo[]> {
  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) throw new Error("PEXELS_API_KEY not configured. Get a free key at https://www.pexels.com/api/")

  const params = new URLSearchParams({
    query: keyword,
    per_page: "20",
    orientation: opts.orientation,
  })
  const url = `https://api.pexels.com/videos/search?${params}`

  const res = await fetchWithRetry(url, {
    headers: {
      Authorization: apiKey,
      "User-Agent": "jianjicode/1.0",
    },
  })
  const data = (await res.json()) as any

  if (!data.videos) {
    console.warn(`[Pexels] Unexpected response for "${keyword}": ${JSON.stringify(data).slice(0, 200)}`)
    return []
  }

  const spec = RESOLUTION_SPEC[opts.resolution]
  const results: MaterialInfo[] = []
  for (const v of data.videos) {
    if (v.duration < opts.minDuration || v.duration > opts.maxDuration) continue
    for (const file of v.video_files) {
      const w = file.width as number
      const h = file.height as number
      if (opts.orientation === "portrait") {
        if (w === spec.h && h === spec.w) {
          results.push({ url: file.link, duration: v.duration, width: w, height: h, provider: "pexels" })
          break
        }
      } else {
        if (w >= spec.w) {
          results.push({ url: file.link, duration: v.duration, width: w, height: h, provider: "pexels" })
          break
        }
      }
    }
  }
  return results
}

// ================================================================
// Pixabay API
// ================================================================

async function searchPixabay(keyword: string, opts: MaterialSearchOptions): Promise<MaterialInfo[]> {
  const apiKey = process.env.PIXABAY_API_KEY
  if (!apiKey) throw new Error("PIXABAY_API_KEY not configured. Get a free key at https://pixabay.com/api/docs/")

  const params = new URLSearchParams({
    q: keyword,
    video_type: "all",
    per_page: "50",
    key: apiKey,
  })
  const url = `https://pixabay.com/api/videos/?${params}`

  const res = await fetchWithRetry(url, {
    headers: { "User-Agent": "jianjicode/1.0" },
  })
  const data = (await res.json()) as any

  if (!data.hits) {
    console.warn(`[Pixabay] Unexpected response for "${keyword}": ${JSON.stringify(data).slice(0, 200)}`)
    return []
  }

  const spec = RESOLUTION_SPEC[opts.resolution]
  const results: MaterialInfo[] = []
  for (const v of data.hits) {
    if (v.duration < opts.minDuration || v.duration > opts.maxDuration) continue
    const videos = v.videos as Record<string, { width: number; height: number; url: string }>
    for (const key of Object.keys(videos).sort((a, b) => {
      const sizes = ["large", "medium", "small"]
      return sizes.indexOf(a.split("_")[0]) - sizes.indexOf(b.split("_")[0])
    })) {
      const file = videos[key]
      const w = file.width
      if (w >= spec.w) {
        results.push({ url: file.url, duration: v.duration, width: w, height: file.height, provider: "pixabay" })
        break
      }
    }
  }
  return results
}

// ================================================================
// Download & cache
// ================================================================

const CACHE_DIR = join(process.cwd(), "outputs", ".material_cache")

async function downloadVideo(url: string, saveDir: string): Promise<string> {
  if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true })

  const cacheKey = urlToCacheKey(url)
  const cachePath = join(CACHE_DIR, `vid-${cacheKey}.mp4`)

  if (existsSync(cachePath) && (await import("node:fs/promises").then(m => m.stat(cachePath))).size > 0) {
    console.log(`[Material] Cache hit: ${cachePath}`)
    return cachePath
  }

  const res = await fetchWithRetry(url, {
    headers: { "User-Agent": "jianjicode/1.0" },
  })
  const buffer = Buffer.from(await res.arrayBuffer())

  const { writeFile } = await import("node:fs/promises")
  await writeFile(cachePath, buffer)

  if (existsSync(cachePath)) {
    const { stat } = await import("node:fs/promises")
    const st = await stat(cachePath)
    if (st.size > 0) return cachePath
  }
  return ""
}

async function validateAndCopy(cachePath: string, outputDir: string, minFps: number): Promise<DownloadedMaterial | null> {
  const { copyFile } = await import("node:fs/promises")
  const { basename } = await import("node:path")

  try {
    const info = await probeMetadata(cachePath)
    if (info.fps < minFps) {
      console.warn(`[Material] Low FPS (${info.fps.toFixed(1)} < ${minFps}), skipping`)
      return null
    }
    if (info.duration <= 0) {
      console.warn(`[Material] Invalid duration, skipping`)
      return null
    }

    if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true })
    const destName = `material_${randomUUID().slice(0, 8)}.mp4`
    const destPath = join(outputDir, destName)
    await copyFile(cachePath, destPath)

    return {
      path: destPath,
      url: "",
      duration: info.duration,
      fps: info.fps,
      width: info.width,
      height: info.height,
      provider: "",
      tags: [],
    }
  } catch (err) {
    console.warn(`[Material] Validation failed: ${(err as Error).message}`)
    return null
  }
}

// ================================================================
// Tool definition
// ================================================================

const paramsSchema = z.object({
  keywords: z.array(z.string()).min(1).max(10)
    .describe("搜索关键词列表。英文关键词效果更好（如 ocean waves, city timelapse）"),
  source: z.enum(["pexels", "pixabay"]).optional().default("pexels")
    .describe("素材来源。pexels 高清质量更高，pixabay 数量更多"),
  target_duration: z.number().min(1).max(300).optional().default(30)
    .describe("目标总时长(秒)，累积下载够即停"),
  min_duration: z.number().min(1).max(60).optional().default(2)
    .describe("单个素材最小时长(秒)"),
  max_duration: z.number().min(1).max(60).optional().default(15)
    .describe("单个素材最大时长(秒)"),
  resolution: z.enum(["720p", "1080p", "4K"]).optional().default("1080p"),
  orientation: z.enum(["portrait", "landscape"]).optional().default("portrait")
    .describe("视频方向。portrait=竖屏(9:16), landscape=横屏(16:9)"),
  fps_min: z.number().min(1).max(60).optional().default(24)
    .describe("最低帧率，低于此帧率的素材会被丢弃"),
  max_results: z.number().min(1).max(20).optional().default(5)
    .describe("最多下载几个素材"),
  output_dir: z.string().optional()
    .describe("输出目录。默认: outputs/material/<uuid>/"),
})

type MaterialArgs = z.infer<typeof paramsSchema>

export function detectChinese(text: string): boolean {
  return /[一-鿿]/.test(text)
}

export const SearchMaterialTool = Tool.define("search_material", {
  description:
    "搜索并下载无版权高清视频素材（B-roll/空镜/背景视频）。支持Pexels和Pixabay双源，自动按分辨率/时长/帧率筛选，缓存去重。视频编辑时用于获取空镜头、背景画面、转场素材等。需要配置 PEXELS_API_KEY 或 PIXABAY_API_KEY 环境变量（免费注册即可）",
  parameters: paramsSchema,
  usageTemplate: {
    json: {
      keywords: ["ocean waves", "city timelapse"],
      source: "pexels",
      target_duration: 30,
      min_duration: 2,
      max_duration: 15,
      resolution: "1080p",
      orientation: "portrait",
      fps_min: 24,
      max_results: 5,
      output_dir: "{output_dir}/material/",
    },
    constraints: [
      "英文关键词搜索效果远好于中文，如需搜中文概念请先翻译成英文",
      "Pexels 质量更高但数量少，Pixabay 数量多但质量参差",
      "下载的素材累积时长达到 target_duration 后自动停止",
      "同一URL的素材只下载一次（自动缓存去重）",
      "需要先配置 PEXELS_API_KEY 或 PIXABAY_API_KEY 环境变量",
    ],
  },
  execute: async (args: MaterialArgs) => {
    const hasChinese = args.keywords.some(detectChinese)
    if (hasChinese) {
      console.warn(
        `[Material] Keywords contain Chinese characters. English keywords yield much better results on Pexels/Pixabay.\n` +
        `  Provided: ${args.keywords.join(", ")}\n` +
        `  Consider translating to English first.`,
      )
    }

    const apiConfigured = process.env.PEXELS_API_KEY || process.env.PIXABAY_API_KEY
    if (!apiConfigured) {
      return {
        title: "素材搜索失败 — 缺少 API Key",
        metadata: {
          operation: "search_material",
          success: false,
          source: args.source,
          keywords: args.keywords,
          downloadedCount: 0,
          totalDuration: 0,
          videoPaths: [],
        },
        output:
          `未配置素材 API Key。请注册免费 Key 后设置环境变量：\n` +
          `- Pexels: https://www.pexels.com/api/ → 设置 PEXELS_API_KEY\n` +
          `- Pixabay: https://pixabay.com/api/docs/ → 设置 PIXABAY_API_KEY\n\n` +
          `在 .env 文件中添加对应变量即可。`,
      }
    }

    const searchFn = args.source === "pixabay" ? searchPixabay : searchPexels
    const searchOpts: MaterialSearchOptions = {
      minDuration: args.min_duration,
      maxDuration: args.max_duration,
      orientation: args.orientation,
      resolution: args.resolution,
    }

    const outputDir = args.output_dir || join(process.cwd(), "outputs", "material", randomUUID().slice(0, 8))
    const allItems: MaterialInfo[] = []
    const seenUrls = new Set<string>()

    console.log(
      `[Material] Searching ${args.source} for: ${args.keywords.join(", ")}, ` +
      `target=${args.target_duration}s, ${args.resolution} ${args.orientation}`,
    )

    for (const keyword of args.keywords) {
      try {
        const items = await searchFn(keyword, searchOpts)
        console.log(`[Material] Found ${items.length} results for "${keyword}"`)
        for (const item of items) {
          if (!seenUrls.has(item.url) && allItems.length < args.max_results * 2) {
            allItems.push(item)
            seenUrls.add(item.url)
          }
        }
      } catch (err) {
        console.error(`[Material] Search failed for "${keyword}": ${(err as Error).message}`)
      }
    }

    if (allItems.length === 0) {
      return {
        title: "素材搜索完成（无匹配结果）",
        metadata: {
          operation: "search_material",
          success: true,
      undoable: true,
          source: args.source,
          keywords: args.keywords,
          downloadedCount: 0,
          totalDuration: 0,
          videoPaths: [],
        },
        output:
          `未找到匹配 "${args.keywords.join(", ")}" 的素材。\n` +
          `建议：换英文关键词、扩大时长范围、或切换素材来源后重试。`,
      }
    }

    const results: DownloadedMaterial[] = []
    let totalDuration = 0

    for (const item of allItems) {
      if (results.length >= args.max_results || totalDuration >= args.target_duration) break

      try {
        console.log(`[Material] Downloading: ${item.url.slice(0, 80)}...`)
        const cachePath = await downloadVideo(item.url, outputDir)
        if (!cachePath) continue

        const validated = await validateAndCopy(cachePath, outputDir, args.fps_min)
        if (validated) {
          validated.provider = item.provider
          validated.url = item.url
          validated.tags = args.keywords
          results.push(validated)
          totalDuration += Math.min(args.max_duration, validated.duration)
          console.log(
            `[Material] Saved: ${validated.path} (${validated.duration.toFixed(1)}s, ${validated.fps}fps, ` +
            `${validated.width}x${validated.height})`,
          )
        }
      } catch (err) {
        console.error(`[Material] Download failed: ${(err as Error).message}`)
      }
    }

    const videoPaths = results.map((r) => r.path)
    console.log(`[Material] Done: ${results.length} videos, ${totalDuration.toFixed(1)}s total`)

    const editOperations: EditOperation[] = results.map((r) => ({
      operationId: generateOperationId(),
      undoable: true,
      type: "add_clip" as const,
      clipId: generateClipId(),
      asset: {
        url: r.path,
        path: r.path,
        type: "video" as const,
      },
      trackKind: "video" as const,
      trackName: "素材库",
      startTime: 0,
      duration: r.duration,
      metadata: {
        toolName: "search_material",
        description: `素材: ${r.provider} ${r.width}x${r.height} (${r.duration.toFixed(1)}s)`,
        timestamp: Date.now(),
      },
    }))

    return {
      title: `素材搜索完成 — ${results.length} 个视频 (${totalDuration.toFixed(1)}s)`,
      metadata: {
        operation: "search_material",
        success: true,
      undoable: true,
        source: args.source,
        keywords: args.keywords,
        downloadedCount: results.length,
        totalDuration,
        videoPaths,
      },
      output:
        `素材搜索完成\n` +
        `来源: ${args.source}\n` +
        `关键词: ${args.keywords.join(", ")}\n` +
        `下载: ${results.length} 个视频, 总时长 ${totalDuration.toFixed(1)}s\n` +
        `目录: ${outputDir}\n` +
        (results.length > 0
          ? `文件: ${videoPaths.map((p) => p.replace(/\\/g, "/").split("/").pop()).join(", ")}`
          : `建议换英文关键词重试`),
      editOperations,
    }
  },
})
