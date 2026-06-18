/**
 * IndexedDB-backed file persistence for browser preview mode.
 * blob: URLs are session-only, so we persist the raw Blobs in IndexedDB
 * and recreate blob URLs after page reload.
 */
const DB_NAME = 'jianjicode-files'
const STORE_NAME = 'asset-files'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

export async function saveAssetFile(assetId: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(blob, assetId)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // IndexedDB may be unavailable (private browsing, etc.) — fail silently
  }
}

export async function getAssetBlob(assetId: string): Promise<Blob | null> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(assetId)
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function deleteAssetFile(assetId: string): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(assetId)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // ignore
  }
}

export async function recreateBlobUrl(assetId: string): Promise<string | null> {
  const blob = await getAssetBlob(assetId)
  if (!blob) return null
  return URL.createObjectURL(blob)
}

export function isBrowserPreview(): boolean {
  return (window as any).__BROWSER_PREVIEW__ === true
}
