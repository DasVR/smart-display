# Penpot Design System Workflow

Step-by-step for structuring a design system in Penpot (open-source Figma alternative) for dev handoff.

## Setup

1. Open Penpot at your instance URL (e.g., http://localhost:9001)
2. Create **New File** → name it descriptively
3. Create **6 pages** (tabs at top):
   - `00 Tokens`
   - `01 Components`
   - `02 Layouts`
   - `03 Flows`
   - `04 States`
   - `05 Specs`

---

## Page 0: Tokens

### Color Styles
Create as Penpot Color Styles (Fill → Color Styles → +):
| Name | Value | Usage |
|------|-------|-------|
| `abyss` | `#050507` | Main bg |
| `abyss-1` | `#0a0a0c` | Raised surface |
| `abyss-3` | `#101016` | Control surface |
| `primary` | `#452a84` | Primary accent |
| `accent` | `#fe6f69` | Warm accent |
| `text` | `#e8e8e6` | Human text |
| `text-dim` | `#9a9a94` | Dim text |

### Text Styles
Format text → Text panel → Text Styles → +
| Name | Font | Size | Weight |
|------|------|------|--------|
| `title/space` | Inter | 13 | 600 |
| `nav/row` | Inter | 12 | 400 |
| `mono/data` | JetBrains Mono | 12 | 400 |
| `micro/label` | Inter | 11 | 500 (uppercase, 0.08em) |

### Document spacing tokens
Create text boxes with the values:
- `sidebar-row`: 28px (6px v-pad, 8px h-pad)
- `status-bar`: 26px
- `gap-sm`: 4px / `gap-md`: 8px / `gap-lg`: 16px

### Document spring curves
Create text boxes with easing values:
- `spring-bouncy`: `cubic-bezier(0.34, 1.56, 0.64, 1)`
- `spring-smooth`: `cubic-bezier(0.22, 1, 0.36, 1)`
- `spring-window`: `cubic-bezier(0.32, 0.72, 0, 1)`

---

## Page 1: Components

### Creating a Component
1. Design the base variant (e.g., primary button default state)
2. Select → Right-click → **Create Component** (or Ctrl+Alt+K)
3. Name: `btn/primary/default`

### Adding Variants
1. Select component → right panel → **Component Properties**
2. Add booleans for states:
   - `state`: default, hover, active, disabled, loading
   - `size`: sm, md, lg
3. Duplicate component for each variant

### Key Components to Build
| Component | Variants |
|-----------|----------|
| `btn/primary` | default, hover, active, disabled, loading; sm/md/lg |
| `btn/secondary` | same |
| `btn/ghost` | same |
| `input/text` | default, focus, error, disabled |
| `card/agent-block` | plan, tool, diff, finding, artifact, approval |
| `sidebar/space` | default, active, hover |
| `status-bar` | — |
| `toast` | default, success, error, warning |

---

## Page 2: Layouts

Build key screens using component instances:

### Main Window
```
┌─ Titlebar (40px) ──────────────────────────────┐
│ [•••]  APP · space      ⌘K  mode · status     │
├──────────┬───────────────────────┬────────────┤
│ SIDEBAR  │   AGENT CONVERSATION  │ INSPECTOR  │
│ (280px)  │   (flex, min 600px)  │ (320px)    │
│          │                       │            │
│ Spaces   │  ┌ Agent block ───┐ │ Findings   │
│ Targets  │  │ Plan/Tool/etc  │ │ Evidence   │
│ Services │  │ [Approve]...   │ │ Timeline   │
│ Creds    │  └──────────────────┘ │ Notes      │
│ Plugins  │                       │            │
├──────────┴───────────────────────┴────────────┤
│ STATUS BAR (26px)                             │
└───────────────────────────────────────────────┘
```

### Other Layouts
- Composer focus (expanded, mode chips visible)
- Command palette (full overlay, centered)
- Settings sheet (left categories, right content)
- Empty state (centered, templates, recent)

Use **Flex Layout** for rows/columns with gap tokens.

---

## Page 3: Flows

Interaction flows using arrows + annotations:

### Agent Loop Flow
```
User types → Finn plans → Finn proposes tool → Approval block
                                        ↓
                                  [Approve] → Runs → Verifies
                                  [Edit]   → Re-propose
                                  [Reject] → Adjusts plan
```

### Space Switch
```
Cmd+1 → instant swap → Sidebar updates → Conversation swaps
                                         → Inspector swaps
                                         → Status updates
```

### YOLO Toggle
```
Click chip: SAFE → YOLO (coral, static)
All subsequent proposals auto-approve
Still rendered as blocks, still logged
Click again: SAFE (violet)
```

---

## Page 4: States

For each component, document the full state matrix:

| Component | Default | Hover | Active | Disabled | Loading | Error | Success |
|-----------|---------|-------|--------|----------|---------|-------|---------|
| btn/primary | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| input/text | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| agent-block | ✓ | — | — | — | ✓ | ✓ | — |

Also document:
- **Reduced motion** variant (no animation, static)
- **Keyboard focus** ring

---

## Page 5: Specs

Dev handoff for each component:

### Props Table
| Prop | Type | Default | Required |
|------|------|---------|----------|
| variant | 'primary' \| 'secondary' \| 'ghost' | 'primary' | no |
| size | 'sm' \| 'md' \| 'lg' | 'md' | no |
| state | ... | 'default' | no |
| loading | boolean | false | no |
| onClick | () => void | — | yes (if interactive) |

### CSS Tokens
List all custom properties consumed:
- `--color-primary`
- `--glass-1`
- `--spring-bouncy`

### Keyboard Interactions
| Key | Action |
|-----|--------|
| Tab | Focus |
| Enter/Space | Activate |
| Esc | Close/cancel |

### ARIA
- Role: `button`, `listbox`, `dialog`, etc.
- Labels: `aria-label`, `aria-describedby`

### Responsive
Document behavior at breakpoints:
- 320px: mobile
- 768px: tablet
- 1024px: desktop
- 1440px: wide

---

## Inspect Panel → Code

1. Select any element
2. Right panel → **Inspect**
3. Shows: CSS, dimensions, colors, fonts, spacing
4. Copy values directly into CSS custom properties

---

## Libraries (Team)

File → **Libraries** → Publish this file as a library
- Other files can consume components via Assets panel
- Update component in library → all instances update
