---
name: penpot-design-mcp
description: Design systems/shapes in self-hosted Penpot via MCP.
---

# Penpot MCP Design (Self-Hosted)

Use when designing a NIL/UI/design-system in Penpot, or when the user asks to create/edit shapes, components, tokens, pages, layouts in Penpot.

## Connection

Penpot runs self-hosted at:
- UI: `http://localhost:9001` or `https://penpot.dasdev.net`
- MCP server: `https://penpot.dasdev.net/mcp/stream?userToken=<token>`
- Token stored at: `/home/das/.penpot_mcp_token`
- Client helper: `/home/das/projects/finn-pentest-harness/cursor-research/penpot_mcp.py`
- Session id cached in `/home/das/.penpot_mcp_session`

## PREREQUISITE (CRITICAL)
The `execute_code` MCP tool only works when the **Penpot MCP plugin is actively connected to an OPEN FILE** in the user's browser. If you get:
> "No plugin instance connected for user token"

It means the user needs to open a Penpot file and connect/enable the MCP plugin inside it. Ask them to do this before attempting execute_code.

## Helper usage

```bash
cd /home/das/projects/finn-pentest-harness/cursor-research
python3 penpot_mcp.py initialize          # start a session (first time)
python3 penpot_mcp.py tools               # list available tools
python3 penpot_mcp.py call execute_code '{...json...}'   # run JS in plugin context
python3 penpot_mcp.py call export_shape '{"shapeId":"<id>","format":"png"}'  # render a shape
python3 penpot_mcp.py call penpot_api_info '{"type":"Rectangle"}'
```

## MCP tools
- `execute_code` — run JS in the Penpot plugin context (the main tool)
- `high_level_overview` — read once, then don't re-read
- `penpot_api_info` — API docs for a type/member
- `export_shape` — export a shape/page/selection to PNG/SVG

## Penpot API essentials (from execute_code context)
- `penpot.root` = root shape of current page
- `penpotUtils.getPages()`, `getPageById`, `getPageByName`, `findShape`, `findShapes`, `shapeStructure(root, depth)`
- `penpot.selection` = shapes the user selected
- Pages contain boards; boards/groups contain low-level shapes (Rectangle, Path, Text, Ellipse, Image, Boolean, SvgRaw)
- `shape.x/y` writable (absolute top-left), `width/height` READ-ONLY — use `shape.resize(w,h)`
- `shape.fills = [{fillColor:"#RRGGBB", fillOpacity:1}]` — must replace whole array; no fill = `[]`
- `shape.name`, `shape.borderRadius`, `shape.strokes`, `shape.shadows`, `shape.opacity`, `shape.rotation`
- Add child: `parent.appendChild(shape)` or `parent.insertChild(index, shape)`
- Flex layout: `board.addFlexLayout()` then `board.flex` props (dir, rowGap, columnGap, alignItems, justifyContent, paddings); use `penpotUtils.addFlexLayout(container, dir)` when board already has children
- Text: `shape.characters`, `shape.fontSize`, `shape.fontId/family/weight`, `penpot.fonts.findByName(...)`, `font.applyToText(text)`
- Clone: `shape.clone()`. Detach: `shape.detach()`. Remove: `shape.remove()`

## Design tokens
- `penpot.library.local.tokens` — TokenCatalog
- `set.addToken({type:"color"|"dimension"|..., name:"color.primary", value:"#RRGGBB"})`
- `shape.applyToken(token, ["fill"])` — async, wait ~100ms
- `penpotUtils.tokenOverview()`, `findTokenByName(name)`

## Components
- `penpot.library.local.createComponent(shapes)` then `.name = "..."`
- `component.instance()` creates instance on page; `instance.component()` to get back
- Variants: `penpot.createVariantFromComponents(instances)` for variant groups

## Style rule
- Colors as uppercase hex (e.g. `#RRGGBB`), fills as arrays
- Use flex layouts for consistent row/column arrangement
- Semantic naming of shapes
- Don't add text that repeats a shape's name
- Adhere strictly to provided design; don't invent colors

## NIL design tokens (the user's palette)
```
--abyss #050507, --abyss-1 #0a0a0c, --abyss-2 #0a0a0e, --abyss-3 #101016, --abyss-4 #16161d
--violet #452a84, --violet-light #a9b1f0, --coral #fe6f69, --cream #f5f2ec
--text #e8e8e6, --text-dim #9a9a94, --text-faint #55554f
--green #00d992 (legacy), --danger #ff5c5c, --warning #ffb454, --info #5cb8ff
Glass tiers 1-4 (blur 32-40px, opacity 0.45-0.72)
Spring curves: bouncy (0.34,1.56,0.64,1), smooth (0.22,1,0.36,1), window (0.32,0.72,0,1), snappy (0.25,0.9,0.25,1)
Fonts: JetBrains Mono (machine/data), Inter (human prose)
```
