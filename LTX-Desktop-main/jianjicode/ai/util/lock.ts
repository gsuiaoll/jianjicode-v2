// Simple lock implementation for jianjicode
export class Lock {
  static async write(name: string): Promise<{ [Symbol.dispose]: () => void }> {
    console.log(`[Lock] Acquired write lock: ${name}`)
    return {
      [Symbol.dispose]: () => {
        console.log(`[Lock] Released write lock: ${name}`)
      },
    }
  }

  static async read(name: string): Promise<{ [Symbol.dispose]: () => void }> {
    console.log(`[Lock] Acquired read lock: ${name}`)
    return {
      [Symbol.dispose]: () => {
        console.log(`[Lock] Released read lock: ${name}`)
      },
    }
  }
}
