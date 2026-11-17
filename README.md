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


### Where the column sits: gutter vs takeover

Two modes, chosen per installation and remembered:

| Mode | What it does | When to use |
|---|---|---|
| `gutter` (default) | Keeps the shipped conversation exactly as it is and puts the panels in the empty band between the transcript drag handle and the turn navigator | You want the panels next to the conversation without losing the drag handle or the turn rail |
| `takeover` | Replaces the conversation slot with a real three-part layout: conversation, splitter, column | You want a draggable full-height column that owns its own width |

```js
dock.getMode()            // 'gutter' | 'takeover'
dock.setMode('takeover')
```

The gutter mode measures three anchors of the shipped layout:

- left = the right transcript handle `.right + 6`
- right = the turn navigator leftmost button `.left − 6`
- top = the conversation tab strip `.bottom + 6`

If the gutter is narrower than 200px a readable panel no longer fits, so that viewport
automatically uses the takeover column instead (and hands the slot back when the window
grows). Nothing ever overlaps conversation text.

Panel width in gutter mode equals the gutter width; widen it by dragging the transcript
handle, which is the shipped way to give the band more room.

### Collapsing

`dock.setCollapsed(id, true)` shrinks a panel to a 25px title bar in either dock; the
state is persisted per panel.
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
