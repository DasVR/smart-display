// Ollama Inference Arbiter — Node.js backend snippet
// Polls /api/ps every 500ms and broadcasts power state via WebSocket

let ollamaPowerState = 'HIGH_PERFORMANCE';

async function pollOllama() {
  try {
    const r = await fetch('http://localhost:11434/api/ps', { signal: AbortSignal.timeout(800) });
    if (!r.ok) throw new Error('ollama unreachable');
    const d = await r.json();
    const hasModels = d.models && d.models.length > 0;
    const newState = hasModels ? 'LOW_POWER' : 'HIGH_PERFORMANCE';
    if (newState !== ollamaPowerState) {
      ollamaPowerState = newState;
      broadcast({ type: 'power', state: newState });
    }
  } catch {
    if (ollamaPowerState !== 'HIGH_PERFORMANCE') {
      ollamaPowerState = 'HIGH_PERFORMANCE';
      broadcast({ type: 'power', state: 'HIGH_PERFORMANCE' });
    }
  }
}

setInterval(pollOllama, 500);

// Frontend: AmbientShader.svelte
// function onPowerState(e) { setLowPower(e.detail === 'LOW_POWER'); }
// window.addEventListener('power-state', onPowerState);
// In render(): if (lowPower) { rafId = requestAnimationFrame(render); return; }
