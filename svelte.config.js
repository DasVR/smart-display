import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';

// STATIC_DEMO=1 builds the self-contained demo for GitHub Pages: a static
// SPA with canned data (src/lib/demo/) instead of the Node server and its
// /api and /ws. BASE_PATH is the Pages sub-path, e.g. /smart-display.
const staticDemo = process.env.STATIC_DEMO === '1';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: staticDemo
			? adapterStatic({ pages: 'build-demo', assets: 'build-demo', fallback: '404.html', strict: false })
			: adapterNode(),
		paths: staticDemo ? { base: process.env.BASE_PATH || '' } : {},
		alias: {
			$lib: './src/lib'
		}
	}
};

export default config;
