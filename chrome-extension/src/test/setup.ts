import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

type Listener = (...args: any[]) => any

function createEventMock<T extends Listener>() {
  const listeners = new Set<T>()

  return {
    listeners,
    reset() {
      listeners.clear()
    },
    event: {
      addListener: vi.fn((listener: T) => {
        listeners.add(listener)
      }),
      removeListener: vi.fn((listener: T) => {
        listeners.delete(listener)
      }),
      hasListener: vi.fn((listener: T) => listeners.has(listener)),
      hasListeners: vi.fn(() => listeners.size > 0),
      addRules: vi.fn(),
      removeRules: vi.fn(),
      getRules: vi.fn(),
    },
  }
}

const storageOnChanged = createEventMock<typeof chrome.storage.onChanged.addListener extends (callback: infer T) => any ? T : never>()
const runtimeOnMessage = createEventMock<typeof chrome.runtime.onMessage.addListener extends (callback: infer T) => any ? T : never>()
const tabsOnActivated = createEventMock<typeof chrome.tabs.onActivated.addListener extends (callback: infer T) => any ? T : never>()
const tabsOnUpdated = createEventMock<typeof chrome.tabs.onUpdated.addListener extends (callback: infer T) => any ? T : never>()
const windowsOnFocusChanged = createEventMock<typeof chrome.windows.onFocusChanged.addListener extends (callback: infer T) => any ? T : never>()
const alarmsOnAlarm = createEventMock<typeof chrome.alarms.onAlarm.addListener extends (callback: infer T) => any ? T : never>()
const notificationsOnClicked = createEventMock<typeof chrome.notifications.onClicked.addListener extends (callback: infer T) => any ? T : never>()

function emitStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName,
): void {
  for (const listener of storageOnChanged.listeners) {
    listener(changes, areaName)
  }
}

function createStorageArea(areaName: chrome.storage.AreaName): chrome.storage.StorageArea & {
  _reset: () => void
} {
  let store: Record<string, unknown> = {}

  const clone = <T>(value: T): T => {
    if (value === undefined || value === null) return value
    if (typeof structuredClone === 'function') {
      return structuredClone(value)
    }
    return JSON.parse(JSON.stringify(value)) as T
  }

  const resolveGet = async (keys?: string | string[] | Record<string, unknown> | null) => {
    if (keys === null || keys === undefined) {
      return clone(store)
    }
    if (typeof keys === 'string') {
      return { [keys]: clone(store[keys]) }
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {}
      for (const key of keys) {
        if (typeof key === 'string' && key in store) {
          result[key] = clone(store[key])
        }
      }
      return result
    }

    const result: Record<string, unknown> = {}
    for (const [key, defaultValue] of Object.entries(keys)) {
      result[key] = key in store ? clone(store[key]) : clone(defaultValue)
    }
    return result
  }

  const get = ((keys?: unknown, callback?: (items: unknown) => void) => {
    const promise = resolveGet(keys as string | string[] | Record<string, unknown> | null | undefined)
    if (callback) {
      void promise.then((items) => callback(items))
      return
    }
    return promise
  }) as chrome.storage.StorageArea['get']

  const getBytesInUse = ((keys?: unknown, callback?: (bytesInUse: number) => void) => {
    const promise = (async () => {
      if (keys === null || keys === undefined) {
        return JSON.stringify(store).length
      }

      const keyList = typeof keys === 'string'
        ? [keys]
        : Array.isArray(keys)
          ? keys.filter((key): key is string => typeof key === 'string')
          : []
      const subset: Record<string, unknown> = {}
      for (const key of keyList) {
        if (key in store) {
          subset[key] = store[key]
        }
      }
      return JSON.stringify(subset).length
    })()

    if (callback) {
      void promise.then((bytesInUse) => callback(bytesInUse))
      return
    }
    return promise
  }) as chrome.storage.StorageArea['getBytesInUse']

  const area: chrome.storage.StorageArea & { _reset: () => void } = {
    get,
    getBytesInUse,
    async getKeys() {
      return Object.keys(store)
    },
    async set(items: Record<string, unknown>) {
      const changes: Record<string, chrome.storage.StorageChange> = {}
      for (const [key, value] of Object.entries(items)) {
        const oldValue = key in store ? clone(store[key]) : undefined
        store[key] = clone(value)
        changes[key] = {
          oldValue,
          newValue: clone(value),
        }
      }

      if (Object.keys(changes).length > 0) {
        emitStorageChange(changes, areaName)
      }
    },
    async remove(keys: string | string[]) {
      const keyList = typeof keys === 'string' ? [keys] : keys
      const changes: Record<string, chrome.storage.StorageChange> = {}

      for (const key of keyList) {
        if (!(key in store)) continue
        changes[key] = {
          oldValue: clone(store[key]),
          newValue: undefined,
        }
        delete store[key]
      }

      if (Object.keys(changes).length > 0) {
        emitStorageChange(changes, areaName)
      }
    },
    async clear() {
      const changes: Record<string, chrome.storage.StorageChange> = {}
      for (const [key, value] of Object.entries(store)) {
        changes[key] = {
          oldValue: clone(value),
          newValue: undefined,
        }
      }
      store = {}

      if (Object.keys(changes).length > 0) {
        emitStorageChange(changes, areaName)
      }
    },
    async setAccessLevel() {
      return
    },
    onChanged: storageOnChanged.event,
    _reset() {
      store = {}
    },
  }

  return area
}

const localStorageArea = createStorageArea('local')
const sessionStorageArea = createStorageArea('session')
const syncStorageArea = createStorageArea('sync')
const managedStorageArea = createStorageArea('managed')

const tabsQueryMock = vi.fn(() => Promise.resolve([]))
const tabsGetMock = vi.fn(() => Promise.resolve({}))
const tabsCreateMock = vi.fn(() => Promise.resolve({}))
const tabsSendMessageMock = vi.fn(() => Promise.resolve())

const runtimeSendMessageMock = vi.fn(async (message: unknown) => {
  for (const listener of runtimeOnMessage.listeners) {
    const response = await new Promise<unknown>((resolve) => {
      let resolved = false
      const sendResponse = (value?: unknown) => {
        resolved = true
        resolve(value)
      }

      const result = listener(
        message,
        {} as chrome.runtime.MessageSender,
        sendResponse,
      ) as unknown

      if (result !== true && !resolved) {
        resolve(undefined)
      }
    })

    if (response !== undefined) {
      return response
    }
  }

  return undefined
})

const chromeMock = {
  storage: {
    local: localStorageArea,
    session: sessionStorageArea,
    sync: syncStorageArea,
    managed: managedStorageArea,
    onChanged: storageOnChanged.event,
  },
  tabs: {
    query: tabsQueryMock,
    get: tabsGetMock,
    create: tabsCreateMock,
    sendMessage: tabsSendMessageMock,
    onActivated: tabsOnActivated.event,
    onUpdated: tabsOnUpdated.event,
  },
  windows: {
    onFocusChanged: windowsOnFocusChanged.event,
    WINDOW_ID_NONE: -1,
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(() => Promise.resolve([])),
    onAlarm: alarmsOnAlarm.event,
  },
  runtime: {
    sendMessage: runtimeSendMessageMock,
    getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
    onMessage: runtimeOnMessage.event,
  },
  notifications: {
    create: vi.fn((_id: string, _options: unknown, callback?: () => void) => {
      callback?.()
    }),
    clear: vi.fn(),
    onClicked: notificationsOnClicked.event,
  },
}

// @ts-expect-error test environment mock
globalThis.chrome = chromeMock

beforeEach(() => {
  localStorageArea._reset()
  sessionStorageArea._reset()
  syncStorageArea._reset()
  managedStorageArea._reset()

  storageOnChanged.reset()
  runtimeOnMessage.reset()
  tabsOnActivated.reset()
  tabsOnUpdated.reset()
  windowsOnFocusChanged.reset()
  alarmsOnAlarm.reset()
  notificationsOnClicked.reset()

  vi.clearAllMocks()
})
