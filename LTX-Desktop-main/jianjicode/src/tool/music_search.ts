import { existsSync, readdirSync, statSync } from "fs"
import { basename, extname, join, relative } from "path"
import z from "zod"
import { Tool } from "./tool.js"

// Music track interface
interface MusicTrack {
  path: string
  filename: string
  category: string
  subcategory?: string
  fullCategoryPath?: string // Full path like "1200可商用纯音乐/400首署名商用/动感激进"
  tags: string[]
  duration?: number
  size?: number
}

// Find music library directory
function findMusicLibrary(): string {
  // 1. Check environment variable
  const envPath = process.env.JIANJICODE_MUSIC_PATH
  if (envPath && existsSync(envPath)) {
    return envPath
  }

  // 2. Try common relative paths (depending on where the tool is run from)
  const possiblePaths = [
    // When running from project root
    "music",
    // When running from jianjicode directory (dist or src)
    "../music",
    "../../music",
    // Absolute path from current working directory
    join(process.cwd(), "music"),
    join(process.cwd(), "..", "music"),
    join(process.cwd(), "..", "..", "music"),
  ]

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      console.log(`[music_search] Found music library at: ${path}`)
      return path
    }
  }

  // 3. Default fallback
  console.warn(
    `[music_search] Music library not found in common locations, using default: music`,
  )
  return "music"
}

// Music library index
class MusicLibraryIndex {
  private tracks: MusicTrack[] = []
  private indexed = false

  constructor(private musicRoot: string) {
    this.musicRoot = musicRoot || findMusicLibrary()
    // Ensure musicRoot is not undefined
    if (!this.musicRoot) {
      throw new Error("Music root path is undefined")
    }
  }

  // Scan the music library and build index
  async scan(): Promise<MusicTrack[]> {
    if (this.indexed && this.tracks.length > 0) {
      return this.tracks
    }

    console.log(`[music_search] Scanning music library at: ${this.musicRoot}`)
    this.tracks = []

    if (!existsSync(this.musicRoot)) {
      console.warn(
        `[music_search] Music directory not found: ${this.musicRoot}`,
      )
      return []
    }

    // Recursively scan for MP3 files
    const scanDir = (dir: string, categoryPath: string[] = []) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = join(dir, entry.name)

          if (entry.isDirectory()) {
            // Directory: add to category path and continue scanning
            const newCategoryPath = [...categoryPath, entry.name]
            scanDir(fullPath, newCategoryPath)
          } else if (
            entry.isFile() &&
            entry.name.toLowerCase().endsWith(".mp3")
          ) {
            // MP3 file: add to index
            const category =
              categoryPath.length > 0 ? categoryPath[0] : "unknown"
            const subcategory =
              categoryPath.length > 1 ? categoryPath[1] : undefined

            // Extract tags from filename
            const filename = entry.name
            const tags = this.extractTags(filename)

            // Get file stats
            let size: number | undefined
            try {
              const stats = statSync(fullPath)
              size = stats.size
            } catch {
              // Ignore stats errors
            }

            const fullCategoryPath =
              categoryPath.length > 0 ? categoryPath.join("/") : undefined

            const track: MusicTrack = {
              path: fullPath,
              filename,
              category,
              subcategory,
              fullCategoryPath,
              tags,
              size,
            }

            this.tracks.push(track)
          }
        }
      } catch (error) {
        console.error(`[music_search] Error scanning directory ${dir}:`, error)
      }
    }

    scanDir(this.musicRoot)

    console.log(`[music_search] Found ${this.tracks.length} music tracks`)
    this.indexed = true
    return this.tracks
  }

  // Extract tags from filename (e.g., "Boss-Battle_Looping.mp3" -> ["boss", "battle", "looping"])
  private extractTags(filename: string): string[] {
    // Remove extension
    const nameWithoutExt = filename.replace(/\.mp3$/i, "")

    // Split by common separators: underscore, hyphen, dot, space
    const parts = nameWithoutExt.split(/[_\-\s.]+/)

    // Convert to lowercase and filter out empty strings
    const tags = parts
      .map((part) => part.toLowerCase().trim())
      .filter((part) => part.length > 0)

    return tags
  }

  // Search tracks by category
  searchByCategory(category: string): MusicTrack[] {
    const normalizedCategory = category.toLowerCase().trim()
    return this.tracks.filter(
      (track) =>
        track.category.toLowerCase().includes(normalizedCategory) ||
        (track.subcategory &&
          track.subcategory.toLowerCase().includes(normalizedCategory)) ||
        (track.fullCategoryPath &&
          track.fullCategoryPath.toLowerCase().includes(normalizedCategory)),
    )
  }

  // Search tracks by keywords (search in tags and filename)
  searchByKeywords(keywords: string): MusicTrack[] {
    const normalizedKeywords = keywords.toLowerCase().trim().split(/\s+/)
    if (normalizedKeywords.length === 0) return []

    return this.tracks.filter((track) => {
      // Check tags
      const tagMatch = normalizedKeywords.some((keyword) =>
        track.tags.some((tag) => tag.includes(keyword)),
      )

      // Check filename
      const filenameMatch = normalizedKeywords.some((keyword) =>
        track.filename.toLowerCase().includes(keyword),
      )

      // Check category/subcategory
      const categoryMatch = normalizedKeywords.some(
        (keyword) =>
          track.category.toLowerCase().includes(keyword) ||
          (track.subcategory &&
            track.subcategory.toLowerCase().includes(keyword)),
      )

      return tagMatch || filenameMatch || categoryMatch
    })
  }

  // Get all unique categories
  getCategories(): string[] {
    const categories = new Set<string>()
    this.tracks.forEach((track) => {
      categories.add(track.category)
      if (track.subcategory) {
        categories.add(`${track.category}/${track.subcategory}`)
      }
    })
    return Array.from(categories).sort()
  }

  // Get random track (useful for recommendations)
  getRandomTrack(): MusicTrack | null {
    if (this.tracks.length === 0) return null
    return this.tracks[Math.floor(Math.random() * this.tracks.length)]
  }

  // Get tracks by mood/emotion (simple mapping)
  getTracksByMood(mood: string): MusicTrack[] {
    const moodMap: Record<string, string[]> = {
      energetic: ["动感激进", "激情战斗", "卡点-节奏", "史诗-震撼"],
      relaxing: ["安静-舒缓", "安静冥想", "轻松愉快"],
      happy: ["有趣-幽默", "Vlog-旅拍", "励志-明朗", "轻松愉快"],
      epic: ["史诗-震撼", "激情战斗", "卡点-节奏"],
      funny: ["有趣-幽默", "趣味古怪"],
      corporate: ["企业-宣传", "励志-明朗"],
      vlog: ["Vlog-旅拍", "轻松愉快"],
      gaming: ["电子游戏", "卡点-节奏", "史诗-震撼"],
      sad: ["悲伤-负面", "安静-舒缓"],
      nature: ["自然-特效", "安静-舒缓"],
    }

    const normalizedMood = mood.toLowerCase().trim()
    const targetCategories = moodMap[normalizedMood] || []

    if (targetCategories.length === 0) {
      // Fallback: search by keyword
      return this.searchByKeywords(mood)
    }

    return this.tracks.filter((track) =>
      targetCategories.some(
        (category) =>
          track.category === category ||
          track.subcategory === category ||
          (track.fullCategoryPath && track.fullCategoryPath.includes(category)),
      ),
    )
  }

  // Recommend tracks for video based on description
  recommendForVideo(videoDescription: string, mood?: string): MusicTrack[] {
    // Simple implementation: use mood if provided, otherwise analyze description
    if (mood) {
      return this.getTracksByMood(mood)
    }

    // Extract keywords from description for basic matching
    const commonKeywords = [
      "action",
      "sport",
      "game",
      "travel",
      "vlog",
      "corporate",
      "funny",
      "epic",
      "relaxing",
      "nature",
    ]
    const descriptionLower = videoDescription.toLowerCase()

    // Find matching keywords
    const matchedKeywords = commonKeywords.filter((keyword) =>
      descriptionLower.includes(keyword),
    )

    if (matchedKeywords.length > 0) {
      // Use the first matched keyword
      return this.getTracksByMood(matchedKeywords[0])
    }

    // Fallback: return random tracks from popular categories
    const popularCategories = ["Vlog-旅拍", "励志-明朗", "轻松愉快", "动感激进"]
    return this.tracks
      .filter((track) => popularCategories.includes(track.category))
      .slice(0, 10) // Limit to 10 tracks
  }
}

// Global index instance
const musicIndex = new MusicLibraryIndex(findMusicLibrary())

export const MusicSearchTool = Tool.define("music_search", {
  description:
    "Search and recommend background music from the music library. Can search by category, keywords, mood, or recommend music for video based on description.",
  parameters: z.object({
    operation: z
      .enum(["scan", "search", "recommend", "categories", "info"])
      .describe(
        "Operation to perform: 'scan' to rescan library, 'search' to search by criteria, 'recommend' to get recommendations for video, 'categories' to list all categories, 'info' to get library info",
      ),

    // Search parameters
    category: z
      .string()
      .optional()
      .describe(
        "Category to search for (e.g., '动感激进', 'Vlog-旅拍', '安静-舒缓')",
      ),
    keywords: z
      .string()
      .optional()
      .describe(
        "Keywords to search for in music filenames and tags (e.g., 'boss battle', 'looping', 'happy')",
      ),
    mood: z
      .string()
      .optional()
      .describe(
        "Mood/emotion for music recommendation (e.g., 'energetic', 'relaxing', 'happy', 'epic', 'funny', 'corporate', 'vlog', 'gaming', 'sad', 'nature')",
      ),

    // Recommendation parameters
    video_description: z
      .string()
      .optional()
      .describe("Description of the video content for music recommendation"),
    video_duration: z
      .number()
      .optional()
      .describe("Duration of video in seconds (for duration matching)"),

    // Output control
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Maximum number of results to return"),
    random: z
      .boolean()
      .optional()
      .default(false)
      .describe("Return random results instead of sorted"),
  }),

  execute: async (args: any, ctx: Tool.Context) => {
    try {
      // Ensure library is scanned
      const tracks = await musicIndex.scan()

      if (tracks.length === 0) {
        return {
          title: "Music library empty or not found",
          metadata: { error: true },
          output:
            "No music tracks found in the library. Make sure the 'music' directory exists with MP3 files.",
        } as any
      }

      let results: MusicTrack[] = []
      let operationTitle = ""

      switch (args.operation) {
        case "scan":
          // Already scanned above
          operationTitle = "Library scan completed"
          results = tracks
          break

        case "categories": {
          const categories = musicIndex.getCategories()
          return {
            title: "Music library categories",
            metadata: { categories, count: categories.length },
            output: `Found ${categories.length} categories:\n\n${categories.map((cat) => `• ${cat}`).join("\n")}`,
          } as any
        }

        case "info": {
          const categoryCount = musicIndex.getCategories().length
          return {
            title: "Music library information",
            metadata: {
              total_tracks: tracks.length,
              categories: categoryCount,
              library_path: "music/",
            },
            output: `Music Library Status:
• Total tracks: ${tracks.length}
• Categories: ${categoryCount}
• Library path: music/

Scan completed successfully. Use 'search' or 'recommend' operations to find music.`,
          } as any
        }

        case "search":
          operationTitle = "Music search results"
          if (args.category) {
            results = musicIndex.searchByCategory(args.category)
          } else if (args.keywords) {
            results = musicIndex.searchByKeywords(args.keywords)
          } else if (args.mood) {
            results = musicIndex.getTracksByMood(args.mood)
          } else {
            // No criteria provided, return all tracks
            results = tracks
          }
          break

        case "recommend":
          operationTitle = "Music recommendations for video"
          if (args.video_description || args.mood) {
            results = musicIndex.recommendForVideo(
              args.video_description || "",
              args.mood,
            )
          } else {
            return {
              title: "Recommendation requires criteria",
              metadata: { error: true },
              output:
                "Please provide either video_description or mood parameter for music recommendation.",
            } as any
          }
          break

        default:
          return {
            title: "Invalid operation",
            metadata: { error: true },
            output: `Invalid operation: ${args.operation}. Supported operations: scan, search, recommend, categories, info`,
          } as any
      }

      // Apply limit
      if (args.random && results.length > 0) {
        // Shuffle array for random results
        const shuffled = [...results].sort(() => Math.random() - 0.5)
        results = shuffled.slice(0, args.limit)
      } else {
        results = results.slice(0, args.limit)
      }

      // Format results
      if (results.length === 0) {
        return {
          title: operationTitle,
          metadata: { count: 0 },
          output:
            "No matching music tracks found. Try different search criteria.",
        } as any
      }

      const resultsText = results
        .map((track, index) => {
          const relativePath = relative(process.cwd(), track.path)
          const categoryInfo = track.subcategory
            ? `${track.category}/${track.subcategory}`
            : track.category
          const tagsInfo =
            track.tags.length > 0
              ? `Tags: ${track.tags.slice(0, 5).join(", ")}`
              : ""
          const sizeInfo = track.size
            ? `Size: ${Math.round((track.size / 1024 / 1024) * 100) / 100} MB`
            : ""

          return `${index + 1}. ${track.filename}
   Path: ${relativePath}
   Category: ${categoryInfo}
   ${tagsInfo}${sizeInfo ? "\n   " + sizeInfo : ""}`
        })
        .join("\n\n")

      return {
        title: operationTitle,
        metadata: {
          count: results.length,
          total_tracks: tracks.length,
          operation: args.operation,
        },
        output: `Found ${results.length} music tracks (out of ${tracks.length} total):\n\n${resultsText}`,
      } as any
    } catch (error: any) {
      return {
        title: "Music search error",
        metadata: { error: true },
        output: `Error during music search: ${error.message}`,
      } as any
    }
  },
})
