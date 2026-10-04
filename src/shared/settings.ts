// Stored in chrome.storage.local: the background service worker has no
// access to the options page's window.localStorage.
const OPENROUTER_API_KEY = 'openrouterApiKey'

export async function getOpenRouterApiKey(): Promise<string | null> {
  const stored = await chrome.storage.local.get(OPENROUTER_API_KEY)
  const key: unknown = stored[OPENROUTER_API_KEY]
  if (typeof key === 'string' && key.length > 0) {
    return key
  }
  else {
    return null
  }
}

// An empty key removes the stored one.
export async function setOpenRouterApiKey(key: string): Promise<void> {
  if (key.length === 0) {
    await chrome.storage.local.remove(OPENROUTER_API_KEY)
  }
  else {
    await chrome.storage.local.set({ [OPENROUTER_API_KEY]: key })
  }
}
