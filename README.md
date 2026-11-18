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
  title: 'My panel',     // label, for hosts that show one
  side: 'left',          // 'left' (default) | 'right'
  component: MyPanel,    // required, a React component
})
```

`define()` throws unless `id` is a non-empty string and `component` is a function; defining an
existing id replaces the earlier definition. It returns a `dispose()` that unregisters the card.

| call | returns |
|---|---|
| `dock.panels()` | `[{ id, title, order, side }]` in registration order |
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
target. Stacking is first-come-first-served in both hosts — a numeric `order` never reorders it.

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
width > span  → pinned by its right edge 6px left of the transcript splitter: the card grows over
                the transcript edge, but it never covers the splitter or the turn rail
otherwise     → pinned to the handle
```

The band is `pointer-events: none` and cards re-enable their own; it never swallows a click meant
for the conversation. With the right sidebar (开始 / terminal / browser) open, the band is clamped to
the conversation area's right edge — it never draws on that panel.

## Panel component contract

1. Render **one root element** and **spread the props you receive** onto it, keeping `style` last:
   `h('div', { ...rest, style: { ...style, /* yours */ } })`.
2. Never position yourself: no `position: fixed`, no explicit width, no margins used to fight the
   dock. The dock owns placement.
3. Your element is the visual rectangle. The dock adds no border, radius, padding or title bar — the
   card's own shell (border, radius, background, shadow) stays.
4. Give it an **intrinsic height** in both hosts. The dock supplies width, flex reset and the 6px
   stack gap, nothing more: `order` and `height` in a definition are accepted for compatibility but
   have no layout effect in 0.3.x.

A stack that fits stays a plain, non-clipping column: cards may draw outside their own box (their
shadow). Only when the cards are **taller than the column** does the band become a scroll container,
and then it grows by the shadow's reach (16px) and pads the same amount back — every card keeps the
exact rectangle it had, and the scrollport's clip line lands in the gutter instead of across a
shadow. Scrolling is wheel/trackpad only: no scrollbar is drawn, because a bar in the gutter would
sit beside the cards as a foreign affordance. While scrolling, a card is cut at the gutter edge,
16px outside the band.

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

`0.3.15`. In use by `dsh-ustc-quota` 1.2.7 and `dsh-codex-advisor` 0.10.0, both on the left by
default. Not published to npm.

## License

MIT
