# Bookmark-Based UI/UX Research — Aug 2026 Session

## Source
Twitter bookmarks cache from `~/.twitter-cli/last_results.json` (auth down, cache alive).

## Animated UI Components Discovered

| Component | Author / URL | What It Does | Use Case |
|-----------|-------------|-------------|----------|
| **Border Beam** | `beam.jakubantalik.com` / `github.com/Jakubantalik/border-beam` | Animated light traveling along container borders via conic-gradient + CSS animation | Hero cards, AI chat boxes, feature highlights, input focus states |
| **Thinking Orbs** | `orbs.jakubantalik.com` | Pulsing animated orbs for "AI thinking" states | Loading indicators, AI processing, stream buffering |
| **Liquid Metal** | `github.com/Jakubantalik/metal-fx` | WebGL liquid-metal shader effect for buttons/cards | Primary CTAs, hero interactive elements, premium feel |
| **Originkit** | `originkit.dev` | 250+ free animated components, copy-paste into React/Framer | Scroll effects, hover states, page transitions |
| **Magic UI** | `magicui.design` | Animated beams, glowing borders, dynamic backgrounds | Full component library drop-in |
| **Animate UI** | `animate-ui.com` | Fully animated shadcn-compatible components | Drop-in React components with built-in motion |
| **404 Animations** | `404.colorion.co` | Pure CSS 404 page animations, zero JS | Error pages, playful dead-end states |

## UI Sound Effects

| Tool | URL | What It Does |
|------|-----|-------------|
| **Cuelume** | `npm install cuelume` | 2KB library, 14 interaction sounds synthesized via Web Audio API. One HTML attribute per element (`data-sound="click"`). Throttles hover playback. No runtime dependencies. |

**Integration pattern:**
```tsx
import "cuelume"; // patches navigator.vibrate + adds audio
// Add data-sound="click" to buttons, data-sound="hover" to nav items
```

## AI Agent / Dev Workflow Tools (from bookmarks)

| Tool | URL | What It Does | Use For |
|------|-----|-------------|---------|
| **Graft** | Medium / GitHub | Context engine — agents stop relearning codebase every session | Caching layer for AI tools |
| **Agent-Reach** | `github.com/Panniantong/Agent-Reach` | AI reads X/Reddit/YouTube/GitHub — zero API keys | Research automation |
| **Code Review Graph** | `code-review-graph.com` | Maps codebase so Claude only reads what changed | 49% fewer tool calls, 89% fewer file reads |
| **Chatpack** | `github.com/chddaniel/chatpack` | Open-source chat infrastructure, 100% free | Portfolio chat feature scaffold |
| **OpenWorker** | `github.com/andrewyng/openworker` | Andrew Ng's open-source AI coworker desktop app | Desktop app architecture reference |
| **OpenNews MCP** | `github.com/6551team/opennews-mcp` | 85+ real-time news sources, AI impact scores | Research/news integration |

## Cursor MCP Plugins for Design/Dev

| MCP Server | URL | What It Does |
|-----------|-----|-------------|
| **Shadcn MCP** | `shadcn.io/mcp` | AI installs shadcn components first-shot |
| **Shadcn UI Remote** | `shadcnspace.com/mcp` | 700+ components from structured registry |
| **Figma MCP** | Cursor marketplace | Connect Figma designs → Cursor code |
| **Vercel MCP** | Cursor marketplace | Deploy from Cursor |
| **Sequential Thinking** | Cursor marketplace | Multi-step reasoning for complex tasks |
| **Context7** | Cursor marketplace | Up-to-date library docs injected into context |

## Research Methodology (when Twitter auth is down)

1. Check `~/.twitter-cli/last_results.json` for cached bookmark data
2. Parse tweet IDs → search for full URLs via `web_search` with tweet text snippets
3. Extract component names and GitHub repos from search results
4. Cross-reference with `21st.dev`, `magicui.design`, and `animate-ui.com` registries
5. Map each discovery to: component type, implementation approach (CSS/React/WebGL), and project fit
