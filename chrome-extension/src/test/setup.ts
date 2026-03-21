import '@testing-library/jest-dom/vitest'

// In-memory chrome.storage implementation
function createStorageArea(): chrome.storage.StorageArea {
  let store: Record<string, unknown> = {}

  return {
    get(keys?: string | string[] | Record<string, unknown> | null) {
      return new Promise((resolve) => {
        if (keys === null || keys === undefined) {
          resolve({ ...store })
          return
        }
        if (typeof keys === 'string') {
          resolve({ [keys]: store[keys] })
          return
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {}
          for (const key of keys) {
            if (key in store) result[key] = store[key]
          }
          resolve(result)
          return
        }
        // Record<string, unknown> — use values as defaults
        const result: Record<string, unknown> = {}
        for (const [key, defaultValue] of Object.entries(keys)) {
          result[key] = key in store ? store[key] : defaultValue
        }
        resolve(result)
      })
    },
    set(items: Record<string, unknown>) {
      return new Promise<void>((resolve) => {
        Object.assign(store, items)
        resolve()
      })
    },
    remove(keys: string | string[]) {
      return new Promise<void>((resolve) => {
        const keyList = typeof keys === 'string' ? [keys] : keys
        for (const key of keyList) {
          delete store[key]
        }
        resolve()
      })
    },
    clear() {
      return new Promise<void>((resolve) => {
        store = {}
        resolve()
      })
    },
    getBytesInUse() {
      return Promise.resolve(JSON.stringify(store).length)
    },
    setAccessLevel() {
      return Promise.resolve()
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
      hasListeners: vi.fn(() => false),
      addRules: vi.fn(),
      removeRules: vi.fn(),
      getRules: vi.fn(),
    },
    // helper for tests
    _reset() {
      store = {}
    },
  } as chrome.storage.StorageArea & { _reset: () => void }
}

// Chrome API mocks
const localStorageArea = createStorageArea()
const sessionStorageArea = createStorageArea()

const chromeMock = {
  storage: {
    local: localStorageArea,
    session: sessionStorageArea,
    sync: createStorageArea(),
    managed: createStorageArea(),
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
      hasListeners: vi.fn(() => false),
    },
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([])),
    get: vi.fn(() => Promise.resolve({})),
    onActivated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
      hasListeners: vi.fn(() => false),
    },
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
      hasListeners: vi.fn(() => false),
    },
  },
  windows: {
    onFocusChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
      hasListeners: vi.fn(() => false),
    },
    WINDOW_ID_NONE: -1,
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(() => Promise.resolve([])),
    onAlarm: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
      hasListeners: vi.fn(() => false),
    },
  },
  runtime: {
    sendMessage: vi.fn(() => Promise.resolve()),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
      hasListeners: vi.fn(() => false),
    },
  },
  notifications: {
    create: vi.fn((_id: string, _opts: unknown, cb?: () => void) => {
      cb?.()
    }),
    clear: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
      hasListeners: vi.fn(() => false),
    },
  },
}

// @ts-expect-error — assigning mock to global
globalThis.chrome = chromeMock

// Reset all storage between tests
beforeEach(() => {
  (localStorageArea as ReturnType<typeof createStorageArea> & { _reset: () => void })._reset()
  ;(sessionStorageArea as ReturnType<typeof createStorageArea> & { _reset: () => void })._reset()
  vi.clearAllMocks()
})
