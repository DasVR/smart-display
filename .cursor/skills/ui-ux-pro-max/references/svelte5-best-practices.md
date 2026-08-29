# Svelte 5 / SvelteKit Best Practices (from ui-ux-pro-max stack data)

## Reactivity (Svelte 5 runes)
- Use `$state` for reactive variables: `let count = $state(0)`
- Use `$derived` for computed values: `let doubled = $derived(count * 2)`
- Use `$effect` for side effects: `$effect(() => console.log(count))`
- Do NOT use `$:` in new runes-mode code (legacy only)

## Props
- Use `$props` in Svelte 5: `let { name, age = 0 } = $props()`
- Provide defaults in destructuring, not separate fallback mutation
- Use rest props: `let { class: className, ...rest } = $props(); <button {...rest}>`

## Bindings
- Use `bind:value` for inputs, `bind:this` for element references, `bind:group` for radio/checkbox groups

## Events
- Svelte 5 event handlers are element properties: `<button onclick={handleClick}>`
- Do NOT use `on:click` or `createEventDispatcher` in new runes-mode code
- Use callback props for component events: `let { onsave } = $props()`

## Lifecycle
- Use `onMount` for initialization and data fetching
- Return cleanup from onMount: `onMount(() => { sub(); return unsub })`
- Use `$effect.pre` and `$effect` instead of beforeUpdate/afterUpdate

## Stores
- Use `writable` for mutable shared state, `readable` for read-only, `derived` for computed
- Use `$storeName` prefix for auto-subscription
- Clean up custom subscriptions in onMount

## Slots
- Use `{@render children()}` instead of `<slot>` in runes mode
- Use `{@render header()}` for named slots

## Styling
- Scoped styles by default; `:global()` sparingly
- Use CSS variables for theming: `style="--color: {color}"`

## Transitions
- Use `in:` and `out:` separately for asymmetric enter/exit
- Add `|local` modifier to prevent ancestor trigger

## Logic
- Use `{#if}` for conditionals, `{#each}` with keys for lists, `{#await}` for promises
- ALWAYS use keys in `{#each}`: `{#each items as item (item.id)}`

## SvelteKit
- Use `+page.svelte` for routes, `+page.js` for data loading, `+page.server.js` for server-only
- Use form actions for server-side form handling
- Use `$app/state` (not `$app/stores`) in new SvelteKit code

## Performance
- Use `{#key id}` for forced re-render
- Use `$derived` for computed state, `$effect` only for external synchronization
- Avoid unnecessary effects

## TypeScript
- Use `<script lang="ts">`
- Type props with an interface: `interface Props { name: string }; let { name }: Props = $props()`

## Accessibility
- Use semantic elements (button, nav, main) not div for everything
- Add aria-live for dynamic content updates
