# Penpot MCP Design System Workflow

Self-hosted Penpot driven via Model Context Protocol — no browser drag-and-drop.

## Prerequisites

- Penpot 2.16+ with MCP enabled (`PENPOT_FLAGS=...enable-mcp`)
- MCP container running (`penpot-mcp`)
- User opens a Penpot file in browser + connects the MCP plugin
- Token stored at `/home/das/.penpot_mcp_token` (chmod 600)
- Helper script: `cursor-research/penpot_mcp.py`

## CRITICAL Pitfall: Active Page

**Plugin appends shapes to whatever page is currently ACTIVE in the browser**, not the page you name in code.

**Always:** After building, verify page contents and move boards using:
```js
const target = penpotUtils.getPageByName('02 Layouts');
target.root.appendChild(board);
```

**Or:** Ask user to switch to the target page before each build batch.

## Session Setup

```bash
cd /home/das/projects/finn-pentest-harness/cursor-research
python3 penpot_mcp.py initialize          # start session
python3 penpot_mcp.py tools               # verify tools
```

## Page Structure (6 pages)

| Page | What to build via MCP |
|------|----------------------|
| `00 Tokens` | Color Styles, Text Styles, token board, color swatch reference |
| `01 Components` | Components with variants (primary/secondary/ghost/danger btn, blocks, cards) |
| `02 Layouts` | Main window, empty state, command palette, settings sheet |
| `03 Flows` | Agent loop, approval flow, Space switch, YOLO toggle (arrows + annotations) |
| `04 States` | Component state matrix (default/hover/active/disabled/loading/error) |
| `05 Specs` | Props table, CSS tokens, keyboard map, ARIA, responsive |

## Shape Creation Quick Ref

```js
// Board (container)
const board = penpot.createBoard();
board.name = 'Glass Card'; board.x = 200; board.y = 200;
board.resize(300, 120);
board.fills = [{ fillColor: '#101016', fillOpacity: 0.65 }];
board.borderRadius = 12;
page.root.appendChild(board);

// Rectangle
const rect = penpot.createRectangle();
rect.resize(160, 40); rect.x = 200; rect.y = 280;
rect.fills = [{ fillColor: '#452A84', fillOpacity: 1 }];
rect.borderRadius = 6;
page.root.appendChild(rect);

// Text
const text = penpot.createText('Approve');
text.growType = 'auto-width';
text.fontFamily = 'Inter'; text.fontSize = 14; text.fontWeight = '600';
text.fills = [{ fillColor: '#F5F2EC', fillOpacity: 1 }];
text.x = 220; text.y = 292;
page.root.appendChild(text);

// Flex layout
board.addFlexLayout(); // then board.flex props
// If board already has children, use: penpotUtils.addFlexLayout(board, 'row')
```

## Design Tokens

```js
const tokens = penpot.library.local.tokens;
let set = tokens.sets.find(s => s.name === 'NIL') || tokens.addSet({ name: 'NIL' });
if (!set.active) set.toggleActive();

// Add color token
set.addToken({ type: 'color', name: 'color.violet', value: '#452A84' });

// Add spacing token
set.addToken({ type: 'spacing', name: 'spacing.gap-md', value: '8' });

// Apply token to shape (async)
shape.applyToken(token, ['fill']);
```

## Components

```js
// Create component from shapes
const comp = penpot.library.local.createComponent([board, label]);
comp.name = 'Button / Primary';

// Instantiate
const instance = comp.instance();
page.root.appendChild(instance);
```

## Moving Boards Between Pages

```js
const page1 = penpot.currentPage;  // where everything landed
const target = penpotUtils.getPageByName('02 Layouts');
for (const child of page1.root.children.slice()) {
    if (child.name === 'NIL Main Window') {
        target.root.appendChild(child);
    }
}
```

## Export / Inspect

```bash
python3 penpot_mcp.py call export_shape '{"shapeId":"d0a2badb-...","format":"png"}'
```

Note: Export may fail with "http error" if the exporter is down. Fallback: screenshot the Penpot UI.

## Full API Reference

See `penpot-design-mcp` skill for complete API docs, common tasks, and NIL-specific token tables.
