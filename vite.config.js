import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const staticDemo = process.env.STATIC_DEMO === '1';
const demoHome = fileURLToPath(new URL('./src/lib/demo/homeLocation.demo.js', import.meta.url));

/** Pages demo only: resolve the home-location module to the demo stand-in,
 *  so the published bundle never contains the kiosk's real coordinates. */
function demoHomeLocation() {
	return {
		name: 'demo-home-location',
		enforce: 'pre',
		async resolveId(source, importer, options) {
			if (!staticDemo || !source.endsWith('homeLocation.js')) return null;
			const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
			return resolved?.id.endsWith('/src/lib/homeLocation.js') ? demoHome : null;
		}
	};
}

export default defineConfig({
	plugins: [demoHomeLocation(), tailwindcss(), sveltekit()],
	server: {
		host: '0.0.0.0',
		port: 3000
	},
	preview: {
		host: '0.0.0.0',
		port: 3000
	}
});
