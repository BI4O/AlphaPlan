import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** The agent server is a separate process; every /api request is proxied to it in dev. */
const AGENT_ORIGIN = process.env.AGENT_ORIGIN ?? "http://127.0.0.1:8787";

export default defineConfig({
	plugins: [react()],
	server: {
		port: Number(process.env.WEB_PORT ?? 5173),
		proxy: {
			"/api": { target: AGENT_ORIGIN, changeOrigin: true, ws: false },
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
