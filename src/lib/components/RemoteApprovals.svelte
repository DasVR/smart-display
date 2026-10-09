<!--
	On every phone remote page (mounted by RemoteTabBar): when an agent is
	waiting on an Allow / Deny, the same card the wall shows slides up above
	the tab bar, so you can answer from the couch. Uses its own /ws
	connection so no page has to wire it up.
-->
<script>
	import { onMount } from 'svelte';
	import ApprovalCard from './ApprovalCard.svelte';

	let list = $state([]);
	let now = $state(Date.now());
	let ws;
	let retry = 0;

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}/ws`);
		ws.onopen = () => (retry = 0);
		ws.onclose = () => setTimeout(connect, Math.min(8000, 1000 * 2 ** retry++));
		ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if ((msg.type === 'init' || msg.type === 'approvals') && Array.isArray(msg.approvals)) list = msg.approvals;
			} catch {
				/* ignore */
			}
		};
	}
	function decide(id, decision) {
		if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'approvals', op: 'decide', id, decision, by: 'phone' }));
		navigator.vibrate?.(10);
	}

	onMount(() => {
		connect();
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => {
			clearInterval(tick);
			if (ws) {
				ws.onclose = null;
				ws.close();
			}
		};
	});

	let live = $derived(list.filter((a) => Date.parse(a.expiresAt) > now));
</script>

{#if live.length}
	<div class="dock">
		<ApprovalCard approvals={live} {now} ondecide={decide} compact />
	</div>
{/if}

<style>
	.dock {
		position: fixed;
		z-index: 25;
		left: 0;
		right: 0;
		bottom: calc(max(0.75rem, env(safe-area-inset-bottom)) + 4.6rem);
		max-width: 24rem;
		margin: 0 auto;
		padding: 0 calc(env(safe-area-inset-left) + 0.75rem) 0 calc(env(safe-area-inset-right) + 0.75rem);
		box-sizing: border-box;
	}
</style>
