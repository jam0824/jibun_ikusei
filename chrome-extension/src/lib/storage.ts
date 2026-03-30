const localStorageLocks = new Map<string, Promise<void>>()

function cloneStorageValue<T>(value: T): T {
  if (value === undefined || value === null) return value
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

async function withLocalStorageLocks<T>(
  keys: readonly string[],
  action: () => Promise<T>,
): Promise<T> {
  const uniqueKeys = [...new Set(keys)].sort()
  const previousLocks = uniqueKeys.map((key) => localStorageLocks.get(key) ?? Promise.resolve())

  let releaseLock!: () => void
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })

  const chainedLocks = uniqueKeys.map((key) => {
    const chainedLock = (localStorageLocks.get(key) ?? Promise.resolve()).then(() => currentLock)
    localStorageLocks.set(key, chainedLock)
    return { key, chainedLock }
  })

  await Promise.all(previousLocks)

  try {
    return await action()
  } finally {
    releaseLock()
    for (const { key, chainedLock } of chainedLocks) {
      void chainedLock.finally(() => {
        if (localStorageLocks.get(key) === chainedLock) {
          localStorageLocks.delete(key)
        }
      })
    }
  }
}

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
  await withLocalStorageLocks([key], async () => {
    await chrome.storage.local.remove(key)
  })
}

export async function removeLocalKeys(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  await withLocalStorageLocks(keys, async () => {
    await chrome.storage.local.remove([...keys])
  })
}

export async function mutateLocal<T>(
  key: string,
  defaultValue: T,
  mutator: (value: T) => T | void | Promise<T | void>,
): Promise<T> {
  return withLocalStorageLocks([key], async () => {
    const current = (await getLocal<T>(key)) ?? cloneStorageValue(defaultValue)
    const next = await mutator(current)
    const value = (next ?? current) as T
    await setLocal(key, value)
    return value
  })
}

export async function transactLocal<TValues extends object, TResult>(
  defaults: TValues,
  runner: (values: TValues) => TResult | Promise<TResult>,
): Promise<TResult> {
  const entries = Object.entries(defaults as Record<string, unknown>)
  const keys = entries.map(([key]) => key)

  return withLocalStorageLocks(keys, async () => {
    const stored = await chrome.storage.local.get(keys)
    const values = {} as TValues

    for (const [key, defaultValue] of entries) {
      values[key as keyof TValues] = (
        stored[key] !== undefined ? stored[key] : cloneStorageValue(defaultValue)
      ) as TValues[keyof TValues]
    }

    const result = await runner(values)
    await chrome.storage.local.set(values)
    return result
  })
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
