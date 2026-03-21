import { describe, expect, it } from 'vitest'
import { getLocal, getSession, removeLocal, setLocal, setSession } from '@ext/lib/storage'

describe('storage', () => {
  describe('local storage', () => {
    it('saves and retrieves a value', async () => {
      await setLocal('test_key', { foo: 'bar' })
      const result = await getLocal<{ foo: string }>('test_key')
      expect(result).toEqual({ foo: 'bar' })
    })

    it('returns undefined for non-existent key', async () => {
      const result = await getLocal<string>('missing_key')
      expect(result).toBeUndefined()
    })

    it('returns default value for non-existent key', async () => {
      const result = await getLocal<number>('missing_key', 42)
      expect(result).toBe(42)
    })

    it('overwrites existing value', async () => {
      await setLocal('key', 'first')
      await setLocal('key', 'second')
      const result = await getLocal<string>('key')
      expect(result).toBe('second')
    })

    it('removes a value', async () => {
      await setLocal('key', 'value')
      await removeLocal('key')
      const result = await getLocal<string>('key')
      expect(result).toBeUndefined()
    })
  })

  describe('session storage', () => {
    it('saves and retrieves a value', async () => {
      await setSession('session_key', [1, 2, 3])
      const result = await getSession<number[]>('session_key')
      expect(result).toEqual([1, 2, 3])
    })

    it('returns undefined for non-existent key', async () => {
      const result = await getSession<string>('missing')
      expect(result).toBeUndefined()
    })

    it('returns default value for non-existent key', async () => {
      const result = await getSession<string>('missing', 'default')
      expect(result).toBe('default')
    })
  })
})
