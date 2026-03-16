import '@testing-library/jest-dom'

class NotificationMock {
  static permission: NotificationPermission = 'denied'
  constructor(title: string, options?: NotificationOptions) {
    void title
    void options
  }
  static requestPermission() {
    return Promise.resolve(NotificationMock.permission)
  }
}

class AudioMock {
  preload = 'auto'
  constructor(src?: string) {
    void src
  }
  play() {
    return Promise.resolve()
  }
}

Object.defineProperty(window, 'Notification', {
  writable: true,
  value: NotificationMock,
})

Object.defineProperty(window, 'Audio', {
  writable: true,
  value: AudioMock,
})

Object.defineProperty(window, 'speechSynthesis', {
  writable: true,
  value: {
    cancel: vi.fn(),
    speak: vi.fn(),
  },
})

beforeEach(() => {
  window.localStorage.clear()
})
