# dsh-panel-dock

One owner for plugin panels in DeepSeek Harness: a **real right-hand column** beside the conversation, plus a managed left stack.

## Why

Without this, every UI plugin invents its own `position: fixed` dock, hand-measures the conversation column, and negotiates stacking with whatever else is docked — which produces overlap, mutual yielding loops, and dependence on internal class names and localized aria labels.

`dsh-panel-dock` takes over the `main` slot, lays out `conversation | splitter | strip` as real flex children, and renders each registered panel **directly** in the strip (no wrapper chrome).

## API

```js
const dock = window.__dshPanelDock   // ready once the dock plugin is active

const dispose = dock.define({
  id: 'my-panel',          // unique
  title: 'My panel',       // used by the collapsed bar
  order: 100,              // lower comes first
  height: 'fill',          // "fill" | "auto" | <pixels>
  component: MyPanel,      // see the contract below
})
```

Other calls: `open()`, `close()`, `isOpen()`, `panels()`, `getWidth()`, `setWidth(px)`, `setCollapsed(id, bool)`, `toggle(id)`, `getLayout()`.

### Where a panel lives

A panel starts on the side its definition asks for (`side: "left" | "right"`, default `right`) and the
user can move it with the panel own toggle button:

```js
dock.toggleSide('my-panel')   // returns the new side
dock.getSide('my-panel')      // read it for the glyph direction
dock.setSide('my-panel', 'left')
```

Moving a panel to the right opens the column; moving the last right panel away closes it. The open
state is remembered, so a reload restores the column exactly as the user left it.


### No UI of its own

The dock is a slot negotiation layer, not a feature the user operates. It never registers a
navigation entry, a button, a dialog or a keyboard shortcut. The only affordances are the ones
the cards already have (for example a card's own icon that moves it between dock sides).

Panels land in one of two hosts, chosen by their side:

| Side | Host | Geometry |
|---|---|---|
| `left` (default) | the sidebar footer stack | full sidebar width, content height, registration order |
| `right` | the band between the transcript handle and the turn rail | left edge = handle right + 6, width = min(band, 480), top = tab strip bottom + 6 |

With nothing on the right the band does not exist at all: no reserved width, no overlay, no
click target. Stacking is first-come-first-served in both hosts — a numeric `order` never
reorders the stack.

```js
dock.getSide('my-panel')      // 'left' | 'right'
dock.toggleSide('my-panel')   // returns the new side
dock.setSide('my-panel', 'right')
```

### Panel component contract
1. Render **one root element** and **spread the props you receive** onto it, keeping `style` last.
2. Never position yourself (`position: fixed`, margins that fight the column, explicit width). The dock owns geometry.
3. Your element is the visual rectangle — the dock adds no border, radius, padding or title bar.
4. On the **left** the dock only supplies `width: 100%`; a panel there must have intrinsic height.
   On the **right** the dock also supplies flex sizing from `height`: `"fill"` grows, a number is fixed,
   `"auto"` keeps the content height.

### Readiness

Client plugin bundles resolve bare module ids only, so the dock publishes a single well-known global instead of a Cordis service. Consumers poll on activation:

```js
const register = () => {
  const dock = window.__dshPanelDock
  if (!dock) return setTimeout(register, 200)
  const dispose = dock.define({ /* … */ })
}
register()
```

## Layout state

`localStorage["dsh.panel-dock.v1"] = { width, collapsed: { [id]: true } }`; width is clamped to 200-720.

## Status

Early development. Right column, height modes, collapse, width drag and persistence are implemented and verified on a test machine; the left stack and the migration of existing plugins are in progress.

## License

MIT
