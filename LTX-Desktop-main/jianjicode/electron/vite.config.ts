import { defineConfig } from "vite"
import { resolve } from "path"
import { execSync } from "child_process"

function electronPlugin() {
  return {
    name: "electron-plugin",
    closeBundle() {
      if (process.env.NODE_ENV !== "production") return

      console.log("[electron-plugin] Compiling main process...")

      const src = resolve(__dirname, "main.ts")
      const outDir = resolve(__dirname, "..", "dist-electron")

      execSync(
        `npx tsc "${src}" --outDir "${outDir}" --module ESNext --moduleResolution bundler --target ES2022 --esModuleInterop --skipLibCheck --strict false --noEmit false`,
        { stdio: "inherit", shell: true }
      )

      const preloadSrc = resolve(__dirname, "preload.ts")
      const preloadOut = resolve(__dirname, "..", "dist-electron", "preload.mjs")

      execSync(
        `npx tsc "${preloadSrc}" --outDir "${outDir}" --module ESNext --moduleResolution bundler --target ES2022 --esModuleInterop --skipLibCheck --strict false --noEmit false`,
        { stdio: "inherit", shell: true }
      )

      const preloadJs = resolve(outDir, "preload.js")
      try {
        const fs = require("fs")
        if (fs.existsSync(preloadJs)) {
          fs.renameSync(preloadJs, preloadOut)
        }
      } catch {}

      console.log("[electron-plugin] Main process compiled")
    }
  }
}

const projectRoot = resolve(__dirname, "..")

export default defineConfig({
  root: __dirname,
  base: "./",
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    minify: "esbuild"
  },
  resolve: {
    alias: {
      "@": projectRoot
    }
  },
  plugins: [electronPlugin()]
})
