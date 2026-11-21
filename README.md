# dsh-panel-dock

One owner for plugin panels in DeepSeek Harness: a managed stack in the sidebar footer, and a band
beside the conversation for cards that need the room next to the transcript.

Plugins register a card and the dock decides where it renders. The card never measures the
conversation column, never negotiates with other cards for space, and never depends on internal
class names or localized aria labels.

## What it is not

It is a slot negotiation layer, not a feature the user operates. It registers no navigation entry,
no button, no dialog and no keyboard shortcut — every affordance on screen belongs to the cards.
There is no dock UI to open, close, widen or collapse.

## API

```js
const dock = window.__dshPanelDock   // present once the dock plugin is active

const dispose = dock.define({
  id: 'my-panel',        // required, unique
  title: 'My panel',     // label, shown by CardShell and hosts
  order: 100,            // stacking position, ascending; ties keep registration order
  side: 'left',          // 'left' (default) | 'right'
  minWidth: 280,         // width below which your content stops being useful (default 280)
  version: '1.2.3',      // optional; shown by CardShell next to the title
  component: MyPanel,    // required, a React component
})
```

`define()` throws unless `id` is a non-empty string and `component` is a function; defining an
existing id replaces the earlier definition. It returns a `dispose()` that unregisters the card.

| call | returns |
|---|---|
| `dock.panels()` | `[{ id, title, order, side, minWidth, version }]` in stacking order |
| `dock.getSide(id)` | `'left' \| 'right'` |
| `dock.setSide(id, side)` | the side that was stored |
| `dock.toggleSide(id)` | the new side |
| `dock.subscribe(listener)` | `unsubscribe()`; fires on every registration and side change |
| `dock.version` | the dock's version string |

## Where a panel lives

A panel starts on the side its definition asks for (`side`, default `left`) and the user moves it
with the card's own control:

```js
dock.getSide('my-panel')      // 'left' | 'right'
dock.toggleSide('my-panel')   // returns the new side
dock.setSide('my-panel', 'right')
```

The choice is persisted per panel id, so a reload restores it.

| Side | Host slot | Geometry |
|---|---|---|
| `left` (default) | `sidebar.footer.action` | full sidebar width, intrinsic height, 6px gap |
| `right` | `shell.overlay` | band between the transcript handle and the turn rail, 6px gap |

With nothing on the right the band does not exist at all: no reserved width, no overlay, no click
target. Stacking is `order` ascending (missing = 100) in both hosts; cards with the same `order` keep
registration order. `order` is how a card states "I belong above/below the others"; it does not affect
anything else.

### Right band anchors

Measured from the shipped layout, never assumed:

| Edge | Rule |
|---|---|
| left | `widthHandle[data-side="right"]` right + 6 |
| right | smallest turn-navigation x that is still right of the handle, minus 6 |
| top | `[data-conversation-tabs]` row bottom + 6 |
| bottom | 8 |

```
width = min(max(span, 200), 480, anchors.right - 8)   // span = anchors.right - anchors.left
inner = railLeft - 6 - (handleRight + 6)     // gutter between the handle and the turn rail
outer = (areaRight - 6) - (railRight + 6)    // gutter between the rail and the column's edge

required = clamp(max(minWidth of the right-side panels, default 280), 120, 480)
             // one column, one width: the most demanding card in it wins

inner >= required   → pinned to the handle (the usual case), width = min(inner, 480)
else outer>=required → pinned to the column's right edge, width = min(outer, 480)
else                → intrusion: width is exactly required, the right edge sits on the column
                      edge, so the card takes the smallest possible bite out of the transcript.
                      Only if even that would cover half the column do the cards fall back to
                      the sidebar stack.
```

The band is `pointer-events: none` and cards re-enable their own; it never swallows a click meant
for the conversation. With the right sidebar (开始 / terminal / browser) open, the band is clamped to
the conversation area's right edge — it never draws on that panel.

## Panel component contract

1. Render **one root element** and **spread the props you receive** onto it, keeping `style` last:
   `h('div', { ...rest, style: { ...style, /* yours */ } })`.
2. Never position yourself: no `position: fixed`, no explicit width, no margins used to fight the
   dock. The dock owns placement.
3. Your element is the visual rectangle. The dock adds no border, radius, padding or title bar by
   itself — the card's own shell (border, radius, background, shadow) stays. If you want the shared
   top bar, render `dock.CardShell` (below); it draws only the header row, never your body.
4. Give it an **intrinsic height** in both hosts. The dock supplies width, flex reset and the 6px
   stack gap, nothing more. `order` decides stacking; `height` is accepted for compatibility but has
   no layout effect.
5. **Do not depend on your DOM parent.** Since 0.4.0 each card lives in a container that
   the dock *moves* between the sidebar stack and the band, so that switching sides never
   remounts you (your state and scroll survive). Parent selectors, `closest()` lookups for
   the host, and anything positional that assumes a fixed DOM ancestry will break.
6. Declare `minWidth` (default 280). It is your statement of the width below which your content
   stops being useful — the dock never renders you narrower in the **right band** and never guesses
   your number. **It does not apply to the left stack**: there the dock gives you the sidebar's
   width (typically ~264px, the host's and the user's to change), so a card that needs 280 will
   still be cut when it sits on the left.
   To find it: force the strip's width to 240/260/280/300/340 and look at a screenshot of your own
   card; pick the narrowest width where no value is cut to `35.2/1…`. `scrollWidth` and text-range
   measurements both miss that cut, so it has to be looked at.

A stack that fits stays a plain, non-clipping column: cards may draw outside their own box (their
shadow). Only when the cards are **taller than the column** does the band become a scroll container,
and then it grows by the shadow's reach (16px) and pads the same amount back — every card keeps the
exact rectangle it had, and the scrollport's clip line lands in the gutter instead of across a
shadow. Scrolling is wheel/trackpad only: no scrollbar is drawn, because a bar in the gutter would
sit beside the cards as a foreign affordance. While scrolling, a card is cut at the gutter edge,
16px outside the band.


## CardShell — the optional shared top bar

A card is a *sidebar card* (侧栏卡片): it lives in the sidebar stack or the band. `dock.CardShell` is
the one shared header row for those cards — a monochrome logo that *is* the side toggle, the title,
and a quiet version. It is **not** a layout container: your frame and body stay yours.

```js
const CardShell = dock.CardShell

function MyCard(props) {
  return h(CardShell, Object.assign({}, props, { id: 'my-panel', actions: h(RefreshButton) }),
    h(MyBody))                       // ← your frame + content, unchanged
}
```

| prop | meaning |
|---|---|
| `id` | required; the registered panel id (the shell reads title/version from it) |
| `title`, `version` | optional overrides for what `define` declared |
| `actions` | optional node rendered at the right end (keep it small; it shares the row) |
| `style` | merged into the header row |

The toggle inside the shell calls `dock.toggleSide(id)`, so the logo is the only control a card needs
for moving between sides. Its aria-label and tooltip follow the dock's locale.

**Terminology**: `panel` alone means a *main-area panel* (a full page hosted by DSH — dsh-loci's
five-view view, for example); anything the dock hosts is a **sidebar card** (侧栏卡片). The dock never
hosts a main-area panel.

## Appearance spec (SSOT)

The dock owns no visuals, but cards look consistent when they follow one spec. This table is the
contract; it is the measured convention of the shipped cards, not an invention.

| | left stack (inside the sidebar) | right band (floating over the conversation) |
|---|---|---|
| frame | `padding: 10px 9px 8px`, `border: 1px solid var(--dsw-alias-border-l1)`, `border-radius: 12` | same |
| background | `var(--dsw-alias-bg-layer-1)` | `var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-module-platform))` |
| shadow | `0 3px 12px rgba(0, 0, 0, 0.16)` | `0 3px 12px rgba(15, 23, 42, 0.06)` — same shape, lighter and cooler: a black cast reads as dirt in the narrow gap between two plates |
| header | `dock.CardShell`: 13px/600 title, 10px secondary version, 18px monochrome logo | same |
| numbers | `font-variant-numeric: tabular-nums` | same |

Theme: use `--dsw-alias-*` tokens only — they inherit light/dark from the host. The one value that
does not adapt is the hard-coded shadow rgba; keep it as above (both are light enough for dark mode).

## Readiness

Client plugin bundles resolve bare module ids only, so the dock publishes a well-known global instead
of a Cordis service. Consumers poll on activation:

```js
const register = () => {
  const dock = window.__dshPanelDock
  if (!dock) return setTimeout(register, 200)
  const dispose = dock.define({ /* … */ })
}
register()
```

## State

`localStorage["dsh.panel-dock.v1"] = { sides: { [id]: "left" | "right" } }`. Unknown ids and
unreadable storage are ignored, so a cleared or private-mode profile just falls back to the
definition defaults.

## Install

Not on npm yet. Install a tarball spec through the host plugin manager; the bundle ships its own
patch:

- `https://github.com/Awenforever/dsh-panel-dock/archive/<commit>.tar.gz`
- `file:C:/<path>/dsh-panel-dock-<version>.tgz`

The client half hot-loads through `dsh-client-hmr`, so no page refresh is needed. Bump the version
for every build you install: `pnpm` treats an unchanged version as already up to date and keeps the
old copy.

## Status

`0.4.0`. In use by `dsh-ustc-quota` 1.2.7 and `dsh-codex-advisor` 0.10.0, both on the left by
default. Not published to npm.

## License

MIT
