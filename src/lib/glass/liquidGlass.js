// `use:liquidGlass`: refracts the live backdrop through a lens-shaped SVG
// displacement map (see displacement.js). Chromium-only, because only
// Chromium accepts `backdrop-filter: url(#filter)`; everywhere else, and
// whenever `enabled` is false, the element keeps its own CSS backdrop blur.
//
// Cost: the map is built once per size (cached), and the filter is one
// displacement pass plus the blur the element already paid for.

import { displacementPixels, lensKey } from './displacement.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const mapCache = new Map();
let defs = null;
let seq = 0;
let supported = null;

export function liquidGlassSupported() {
	if (supported !== null) return supported;
	if (typeof window === 'undefined' || typeof CSS === 'undefined') return (supported = false);
	const ua = navigator.userAgent || '';
	supported = /Chrom(e|ium)\//.test(ua) && CSS.supports('backdrop-filter', 'url(#a) blur(1px)');
	return supported;
}

function ensureDefs() {
	if (defs?.isConnected) return defs;
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('width', '0');
	svg.setAttribute('height', '0');
	svg.style.position = 'absolute';
	svg.style.pointerEvents = 'none';
	defs = document.createElementNS(SVG_NS, 'defs');
	svg.appendChild(defs);
	document.body.appendChild(svg);
	return defs;
}

function mapUrl(w, h, radius, bezel) {
	const key = lensKey(w, h, radius, bezel);
	const hit = mapCache.get(key);
	if (hit) return hit;
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(w);
	canvas.height = Math.round(h);
	const ctx = canvas.getContext('2d');
	const img = ctx.createImageData(canvas.width, canvas.height);
	img.data.set(displacementPixels(w, h, { radius, bezel }));
	ctx.putImageData(img, 0, 0);
	const url = canvas.toDataURL('image/png');
	// a handful of sizes at most (trough, nav pill per tab); keep it bounded
	if (mapCache.size > 24) mapCache.delete(mapCache.keys().next().value);
	mapCache.set(key, url);
	return url;
}

function cornerRadius(node, fallback) {
	const r = parseFloat(getComputedStyle(node).borderTopLeftRadius);
	return Number.isFinite(r) ? r : fallback;
}

/**
 * @param {HTMLElement} node
 * @param {{ enabled?: boolean, radius?: number, bezel?: number, strength?: number, blur?: number, saturate?: number }} [params]
 *   radius:   corner radius in px (default: the element's own border-radius)
 *   bezel:    width of the curved rim in px
 *   strength: how far the rim bends the backdrop, in px
 */
export function liquidGlass(node, params = {}) {
	let opts = params;
	let filter = null;
	let feImage = null;
	let feMap = null;
	let ro = null;
	let frame = 0;
	const id = `liquid-glass-${++seq}`;

	function build() {
		const d = ensureDefs();
		filter = document.createElementNS(SVG_NS, 'filter');
		filter.setAttribute('id', id);
		filter.setAttribute('x', '0');
		filter.setAttribute('y', '0');
		filter.setAttribute('width', '100%');
		filter.setAttribute('height', '100%');
		filter.setAttribute('filterUnits', 'userSpaceOnUse');
		filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
		filter.setAttribute('color-interpolation-filters', 'sRGB');
		feImage = document.createElementNS(SVG_NS, 'feImage');
		feImage.setAttribute('x', '0');
		feImage.setAttribute('y', '0');
		feImage.setAttribute('result', 'lens');
		feImage.setAttribute('preserveAspectRatio', 'none');
		feMap = document.createElementNS(SVG_NS, 'feDisplacementMap');
		feMap.setAttribute('in', 'SourceGraphic');
		feMap.setAttribute('in2', 'lens');
		feMap.setAttribute('xChannelSelector', 'R');
		feMap.setAttribute('yChannelSelector', 'G');
		filter.append(feImage, feMap);
		d.appendChild(filter);
	}

	function teardown() {
		ro?.disconnect();
		ro = null;
		cancelAnimationFrame(frame);
		filter?.remove();
		filter = feImage = feMap = null;
		node.style.removeProperty('backdrop-filter');
		node.style.removeProperty('-webkit-backdrop-filter');
		delete node.dataset.lens;
	}

	function measure() {
		if (!filter) return;
		const w = node.offsetWidth;
		const h = node.offsetHeight;
		if (w < 8 || h < 8) return;
		const radius = opts.radius ?? cornerRadius(node, 24);
		const bezel = opts.bezel ?? Math.min(22, Math.min(w, h) / 2.5);
		filter.setAttribute('width', String(w));
		filter.setAttribute('height', String(h));
		feImage.setAttribute('width', String(w));
		feImage.setAttribute('height', String(h));
		// sizes snap to 4px so a morphing element reuses a few maps instead
		// of building one per frame; the image is stretched to fit
		const q = (n) => Math.max(8, Math.round(n / 4) * 4);
		feImage.setAttribute('href', mapUrl(q(w), q(h), radius, bezel));
		feMap.setAttribute('scale', String(opts.strength ?? 48));
		const blur = opts.blur ?? 3;
		const sat = opts.saturate ?? 1.45;
		const value = `url(#${id}) blur(${blur}px) saturate(${sat})`;
		node.style.setProperty('backdrop-filter', value);
		node.style.setProperty('-webkit-backdrop-filter', value);
		node.dataset.lens = 'on';
	}

	function apply() {
		const want = opts.enabled !== false && liquidGlassSupported();
		if (!want) {
			if (filter) teardown();
			return;
		}
		if (!filter) {
			build();
			ro = new ResizeObserver(() => {
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(measure);
			});
			ro.observe(node);
		}
		measure();
	}

	apply();
	return {
		update(next = {}) {
			opts = next;
			apply();
		},
		destroy: teardown
	};
}
