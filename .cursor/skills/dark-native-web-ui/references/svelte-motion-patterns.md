# svelte-motion Patterns

> svelte-motion = Framer Motion API for Svelte 5
> npm install svelte-motion

## Installation

```bash
cd /path/to/sveltekit-project
npm install svelte-motion
```

## Basic Motion Component

```svelte
<script>
  import { Motion } from 'svelte-motion';
</script>

<Motion
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
  let:motion
>
  <div use:motion class="panel">
    Content here
  </div>
</Motion>
```

## Spring Transitions

```svelte
<Motion
  initial={{ scale: 0.9 }}
  animate={{ scale: 1 }}
  transition={{
    type: 'spring',
    stiffness: 400,
    damping: 25,
    mass: 1
  }}
  let:motion
>
  <div use:motion>Springy</div>
</Motion>
```

## AnimatePresence (Enter/Exit)

```svelte
<script>
  import { AnimatePresence, Motion } from 'svelte-motion';
  let show = $state(false);
</script>

<button onclick={() => show = !show}>Toggle</button>

<AnimatePresence>
  {#if show}
    <Motion
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      let:motion
    >
      <div use:motion class="modal">Hello</div>
    </Motion>
  {/if}
</AnimatePresence>
```

## Layout Animation

```svelte
<Motion
  layout
  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
  let:motion
>
  <div use:motion class="card">Auto-layout animated</div>
</Motion>
```

## Gestures (Hover / Tap)

```svelte
<Motion
  whileHover={{ scale: 1.05 }}
  whileTap={{ scale: 0.95 }}
  transition={{ type: 'spring', stiffness: 400 }}
  let:motion
>
  <button use:motion>Hover me</button>
</Motion>
```

## Staggered Children

```svelte
<script>
  import { Motion } from 'svelte-motion';
  const items = ['a', 'b', 'c'];
  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };
  const item = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 }
  };
</script>

<Motion
  variants={container}
  initial="hidden"
  animate="show"
  let:motion
>
  <div use:motion>
    {#each items as i}
      <Motion variants={item} let:motion>
        <div use:motion>{i}</div>
      </Motion>
    {/each}
  </div>
</Motion>
```

## Reduced Motion Support

```svelte
<script>
  const prefersReduced = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
</script>

<Motion
  initial={prefersReduced ? {} : { opacity: 0 }}
  animate={prefersReduced ? {} : { opacity: 1 }}
  transition={prefersReduced ? { duration: 0 } : { duration: 0.3 }}
  let:motion
>
  <div use:motion>Accessible content</div>
</Motion>
```

## Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| Layout shift on mount | Motion component measures before layout | Use `layout` prop or set explicit dimensions |
| Stutter on mobile | Too many simultaneous motion components | Limit to 3-5 active motions at once |
| SSR hydration mismatch | Motion reads DOM before hydration | Wrap in `{#if browser}` or use `initial={}` guard |
| Bundle bloat | Importing full library | Use scoped imports: `import { Motion } from 'svelte-motion'` |
| Scroll-linked performance | `useScroll` + `useTransform` on every element | Use `will-change: transform` sparingly, debounce scroll |
