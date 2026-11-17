import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampWidth, heightStyle, normalizePanels, parseLayout, serializeLayout, isCollapsed, toggleCollapsed, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH } from '../dock-core.js'

test('clampWidth keeps sane values and rejects junk', () => {
  assert.equal(clampWidth(320), 320)
  assert.equal(clampWidth(10), MIN_WIDTH)
  assert.equal(clampWidth(99999), MAX_WIDTH)
  assert.equal(clampWidth(undefined), DEFAULT_WIDTH)
  assert.equal(clampWidth('abc'), DEFAULT_WIDTH)
  assert.equal(clampWidth(320.6), 321)
})

test('heightStyle maps the three modes', () => {
  assert.deepEqual(heightStyle('fill'), { flex: '1 1 0' })
  assert.deepEqual(heightStyle('auto'), { flex: '0 0 auto' })
  assert.deepEqual(heightStyle(240), { flex: '0 0 240px' })
  assert.deepEqual(heightStyle(0), { flex: '1 1 0' })
  assert.deepEqual(heightStyle(undefined), { flex: '1 1 0' })
})

test('normalizePanels sorts by order then id and tolerates junk', () => {
  const sorted = normalizePanels([
    { id: 'b', order: 200 },
    { id: 'a', order: 100 },
    { id: 'c' },
    { id: 'a2', order: 100 },
  ]).map((p) => p.id)
  assert.deepEqual(sorted, ['a', 'a2', 'c', 'b'])
  assert.deepEqual(normalizePanels(null), [])
})

test('parseLayout falls back to defaults on junk', () => {
  assert.deepEqual(parseLayout(''), { width: DEFAULT_WIDTH, collapsed: {} })
  assert.deepEqual(parseLayout('not json'), { width: DEFAULT_WIDTH, collapsed: {} })
  assert.deepEqual(parseLayout('null'), { width: DEFAULT_WIDTH, collapsed: {} })
  assert.deepEqual(parseLayout(JSON.stringify({ width: 10 })), { width: MIN_WIDTH, collapsed: {} })
  assert.deepEqual(parseLayout(JSON.stringify({ width: 440, collapsed: { a: true, b: 1 } })), { width: 440, collapsed: { a: true, b: false } })
})

test('serialize then parse round-trips', () => {
  const layout = { width: 440, collapsed: { alpha: true } }
  assert.deepEqual(parseLayout(serializeLayout(layout)), layout)
})

test('collapse helpers are pure', () => {
  const layout = { width: 300, collapsed: {} }
  const toggled = toggleCollapsed(layout, 'alpha')
  assert.equal(isCollapsed(toggled, 'alpha'), true)
  assert.equal(isCollapsed(layout, 'alpha'), false)
  assert.deepEqual(toggleCollapsed(toggled, 'alpha').collapsed, { alpha: false })
})
