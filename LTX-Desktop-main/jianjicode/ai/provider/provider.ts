// Simplified provider for jianjicode - redirect to simple-provider

export type { Model } from "./simple-provider.js"
export { SimpleProvider as Provider } from "./simple-provider.js"

// Minimal exports to satisfy imports
export function getProvider() {
  return { id: "jianjicode", name: "Jianjicode Video Editor" }
}

export function getAvailableProviders() {
  return ["openai", "anthropic", "google", "vercel", "azure", "custom"]
}

export function getProviderByID(id: string) {
  return { id, name: id.charAt(0).toUpperCase() + id.slice(1) }
}
