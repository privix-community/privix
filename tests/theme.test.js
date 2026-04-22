import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getTheme,
  getThemeOption,
  getThemeOptions,
  getThemePreset,
  initTheme,
  onThemeChange,
  setThemePreset,
} from '../src/lib/theme.js'

const originalWindow = global.window
const originalDocument = global.document
const originalLocalStorage = global.localStorage

function createStorage() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

function createWindow({ prefersDark = false } = {}) {
  const listeners = new Map()
  return {
    matchMedia(query) {
      return { matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false }
    },
    addEventListener(type, listener) {
      const bucket = listeners.get(type) || new Set()
      bucket.add(listener)
      listeners.set(type, bucket)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatchEvent(event) {
      const bucket = listeners.get(event.type)
      if (!bucket) return true
      for (const listener of bucket) listener(event)
      return true
    },
  }
}

function createDocument() {
  const styleMap = {}
  return {
    documentElement: {
      dataset: {},
      style: {
        setProperty(name, value) {
          styleMap[name] = value
        },
        getPropertyValue(name) {
          return styleMap[name] || ''
        },
      },
    },
  }
}

function mountThemeHarness(options = {}) {
  global.localStorage = createStorage()
  global.document = createDocument()
  global.window = createWindow(options)
}

test.beforeEach(() => {
  mountThemeHarness()
})

test.after(() => {
  if (originalWindow === undefined) delete global.window
  else global.window = originalWindow

  if (originalDocument === undefined) delete global.document
  else global.document = originalDocument

  if (originalLocalStorage === undefined) delete global.localStorage
  else global.localStorage = originalLocalStorage
})

test('theme options expose the agreed preset set and order', () => {
  assert.deepEqual(
    getThemeOptions().map(option => option.id),
    ['light', 'dark'],
  )
  // label 走 i18n;测试不初始化 i18n,直接核对 labelKey 契约
  assert.equal(getThemeOption('dark').labelKey, 'theme.dark_label')
})

test('initTheme migrates legacy light preference to light preset', () => {
  global.localStorage.setItem('privix-community-theme', 'light')

  initTheme()

  assert.equal(global.localStorage.getItem('privix-community-theme-preset'), 'light')
  assert.equal(global.localStorage.getItem('privix-community-theme'), null)
  assert.equal(getThemePreset(), 'light')
  assert.equal(getTheme(), 'light')
  assert.equal(global.document.documentElement.dataset.theme, 'light')
})

test('initTheme migrates old dark key to dark preset', () => {
  global.localStorage.setItem('clawpanel-theme', 'dark')

  initTheme()

  assert.equal(global.localStorage.getItem('privix-community-theme-preset'), 'dark')
  assert.equal(global.localStorage.getItem('clawpanel-theme'), null)
  assert.equal(getThemePreset(), 'dark')
  assert.equal(getTheme(), 'dark')
  assert.equal(global.document.documentElement.dataset.theme, 'dark')
})

test('initTheme defaults to light instead of following system dark preference', () => {
  mountThemeHarness({ prefersDark: true })

  initTheme()

  assert.equal(getThemePreset(), 'light')
  assert.equal(getTheme(), 'light')
  assert.equal(global.localStorage.getItem('privix-community-theme-preset'), 'light')
})

test('setThemePreset applies dataset values and dispatches theme change event', () => {
  const events = []
  const stop = onThemeChange((detail) => events.push(detail))

  const applied = setThemePreset('dark')

  stop()

  assert.equal(applied.id, 'dark')
  assert.equal(global.localStorage.getItem('privix-community-theme-preset'), 'dark')
  assert.equal(getThemePreset(), 'dark')
  assert.equal(getTheme(), 'dark')
  assert.equal(global.document.documentElement.dataset.theme, 'dark')
  assert.equal(events.length, 1)
  assert.equal(events[0].id, 'dark')
  assert.deepEqual(events[0].swatches, ['#000000', '#5A72EE', '#C7D9FF'])
})
