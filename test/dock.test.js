import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GAP, MIN_WIDTH_FLOOR, MAX_COVER_RATIO, MAX_PANEL_WIDTH, DEFAULT_MIN_WIDTH, isVisibleAnchor, railColumn, pagePlan, planBand, sideOf } from '../dock-core.js'

const VW = 2560
const anchors = (over) => Object.assign({
  left: 1886, right: 2513, top: 121, handleLeft: 1870, handleRight: 1880,
  railRight: 2540, areaRight: 2560, areaLeft: 0, pageTop: 96, tabsSeen: true, pageRight: null,
}, over)

test('hidden anchors (0x0 splitter) are not anchors', () => {
  assert.equal(isVisibleAnchor({ width: 0, height: 0 }), false)
  assert.equal(isVisibleAnchor({ width: 10, height: 0 }), false)
  assert.equal(isVisibleAnchor({ width: 10, height: 400 }), true)
  assert.equal(isVisibleAnchor(null), false)
})

test('the rail is a column, never a single stray button', () => {
  assert.equal(railColumn([]), null)
  assert.equal(railColumn([{ left: 342, right: 358 }]), null, 'one floating 跳转 button is not the rail')
  const full = Array.from({ length: 45 }, () => ({ left: 2513, right: 2529 }))
  assert.equal(railColumn(full).left, 2513)
  const short = [{ left: 2513, right: 2529 }, { left: 2514, right: 2530 }]
  assert.equal(railColumn(short).left, 2513, 'a short conversation still shares one x')
  // a cluster of four wins over two scattered strays
  const mixed = [{ left: 300, right: 316 }, { left: 340, right: 356 },
    { left: 800, right: 816 }, { left: 800, right: 816 }, { left: 801, right: 817 }, { left: 800, right: 816 }]
  assert.equal(railColumn(mixed).left, 800)
})

test('conversation: the band uses the whitespace left of the rail', () => {
  const plan = planBand(anchors(), 280, { vw: VW, lastWidth: 480 })
  assert.equal(plan.mode, 'inner')
  assert.equal(plan.left, 1886)
  assert.equal(plan.width, 480, 'capped at MAX_PANEL_WIDTH')
})

test('conversation: narrow whitespace falls back to the gutter right of the rail', () => {
  // inner = 2000-1886 = 114 < required; outer = 2554-(2540+6) = 8: neither fits
  const tight = planBand(anchors({ right: 2000, railRight: 2540 }), 280, { vw: VW });
  assert.equal(tight.mode, 'intrude')
  assert.equal(tight.rightEdge, VW - GAP)
  // give the rail room on its right instead
  const outer = planBand(anchors({ right: 2000, railRight: 2100 }), 280, { vw: VW });
  assert.equal(outer.mode, 'outer');
  assert.equal(outer.rightEdge, VW - GAP);
})

test('conversation without a turn rail (轨迹/看板) stays on the right edge', () => {
  const plan = planBand(anchors({ railRight: null }), 280, { vw: VW, lastWidth: 480 })
  assert.equal(plan.mode, 'page')
  assert.equal(plan.top, 121, 'uses the conversation own top, not the window top')
  assert.equal(plan.rightEdge, VW - GAP)
  assert.equal(plan.width, 480)
})

test('no surface at all: main-area page plan below its tabs', () => {
  const bare = { left: null, right: null, top: 0, handleLeft: null, handleRight: null,
    railRight: null, areaRight: null, areaLeft: null, pageTop: 96, tabsSeen: false, pageRight: null }
  const plan = planBand(bare, 280, { vw: VW, lastWidth: 480 })
  assert.equal(plan.mode, 'page')
  assert.equal(plan.top, 96)
  assert.equal(plan.width, 480, 'keeps the familiar width')
})

test('full-width page keeps the familiar width instead of shrinking', () => {
  // Memory: content runs to 2532, so there is no gutter worth using
  const plan = pagePlan({ pageRight: 2532, areaRight: null }, 280, 96, { vw: VW, lastWidth: 480 })
  assert.equal(plan.width, 480)
  assert.equal(plan.rightEdge, VW - GAP)
})

test('a real gutter shrinks the band into it', () => {
  // content ends at 2100: gutter = 2560-2100-12 = 448 -> min(480, 448)
  const plan = pagePlan({ pageRight: 2100, areaRight: null }, 280, 96, { vw: VW, lastWidth: 480 })
  assert.equal(plan.width, 448)
  // a gutter narrower than the card minimum is not usable: keep the familiar width
  const narrow = pagePlan({ pageRight: 2500, areaRight: null }, 280, 96, { vw: VW, lastWidth: 480 })
  assert.equal(narrow.width, 480)
})

test('first frame on a page uses the required width, later frames remember', () => {
  const first = pagePlan({ pageRight: null }, 280, 56, { vw: VW, lastWidth: 0 })
  assert.equal(first.width, 280)
  const later = pagePlan({ pageRight: null }, 280, 56, { vw: VW, lastWidth: 480 })
  assert.equal(later.width, 480)
})

test('a falling-back band sends right-preferring cards to the left stack', () => {
  assert.equal(sideOf('right', undefined, false), 'right')
  assert.equal(sideOf('right', 'left', false), 'left', 'the user choice wins')
  assert.equal(sideOf('right', undefined, true), 'left', 'no band -> left stack')
  assert.equal(sideOf('left', 'right', false), 'right');
})

test('constants in client.js match this model (drift guard)', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const num = (name) => {
    const m = src.match(new RegExp('const ' + name + ' = (\\d+(?:\\.\\d+)?)'));
    assert.ok(m, name + ' missing from client.js');
    return Number(m[1]);
  };
  assert.equal(num('GAP'), GAP);
  assert.equal(num('MIN_WIDTH_FLOOR'), MIN_WIDTH_FLOOR);
  assert.equal(num('MAX_COVER_RATIO'), MAX_COVER_RATIO);
  assert.equal(num('MAX_PANEL_WIDTH'), MAX_PANEL_WIDTH);
  assert.equal(num('DEFAULT_MIN_WIDTH'), DEFAULT_MIN_WIDTH);
  assert.match(src, /const VERSION = '0\.7\.\d+'/);
  // The deck and the frame are part of the current contract; both must still be wired.
  assert.match(src, /const DECK_PEEK = 24/);
  assert.match(src, /'data-panel-dock-frame'/);
  assert.match(src, /const STICKY_PLAN_MS = 2500/);
})
