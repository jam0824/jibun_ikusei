/** Typed wrapper around chrome.storage.local */
export async function getLocal<T>(key: string, defaultValue?: T): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key)
  const value = result[key]
  return value !== undefined ? (value as T) : defaultValue
}

export async function setLocal<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

export async function removeLocal(key: string): Promise<void> {
  await chrome.storage.local.remove(key)
}

/** Typed wrapper around chrome.storage.session */
export async function getSession<T>(key: string, defaultValue?: T): Promise<T | undefined> {
  const result = await chrome.storage.session.get(key)
  const value = result[key]
  return value !== undefined ? (value as T) : defaultValue
}

export async function setSession<T>(key: string, value: T): Promise<void> {
  await chrome.storage.session.set({ [key]: value })
}

export async function removeSession(key: string): Promise<void> {
  await chrome.storage.session.remove(key)
}
