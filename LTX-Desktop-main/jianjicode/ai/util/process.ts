// Process utilities for jianjicode
import {
  type ChildProcess,
  type SpawnOptions,
  spawn,
  spawnSync,
} from "child_process"

export namespace Process {
  export interface RunOptions {
    cwd?: string
    abort?: AbortSignal
    kill?: boolean
    timeout?: number
    nothrow?: boolean
    env?: Record<string, string>
  }

  export interface RunResult {
    code: number
    stdout: Buffer
    stderr: Buffer
  }

  export async function run(
    cmd: string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd[0], cmd.slice(1), {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        signal: options?.abort,
      })

      let stdout = Buffer.from("")
      let stderr = Buffer.from("")

      proc.stdout?.on("data", (chunk) => {
        stdout = Buffer.concat([stdout, chunk])
      })

      proc.stderr?.on("data", (chunk) => {
        stderr = Buffer.concat([stderr, chunk])
      })

      proc.on("close", (code) => {
        if (code === 0 || options?.nothrow) {
          resolve({ code: code || 0, stdout, stderr })
        } else {
          const error = new Error(`Process exited with code ${code}`)
          ;(error as any).code = code
          ;(error as any).stdout = stdout.toString()
          ;(error as any).stderr = stderr.toString()
          reject(error)
        }
      })

      proc.on("error", reject)

      if (options?.timeout) {
        setTimeout(() => {
          if (options.kill) {
            proc.kill("SIGKILL")
          }
          reject(new Error(`Process timeout after ${options.timeout}ms`))
        }, options.timeout)
      }
    })
  }
}
