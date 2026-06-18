// Event bus for jianjicode
export class EventBus {
  private listeners = new Map<string, Function[]>()

  on(event: string, callback: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(callback)
    return () => {
      const listeners = this.listeners.get(event) || []
      const index = listeners.indexOf(callback)
      if (index > -1) listeners.splice(index, 1)
    }
  }

  emit(event: string, ...args: unknown[]): void {
    const listeners = this.listeners.get(event) || []
    listeners.forEach((callback) => callback(...args))
  }
}

export const bus = new EventBus()
