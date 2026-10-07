/** Minimal static file serving for the built web app. */

import { readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
	".map": "application/json; charset=utf-8",
};

/** Returns false when the path is outside the root or does not name a file. */
export async function serveStatic(response: ServerResponse, webRoot: string, urlPath: string): Promise<boolean> {
	const root = resolve(webRoot);
	const target = resolve(root, `.${urlPath === "/" ? "/index.html" : urlPath}`);
	if (target !== root && !target.startsWith(root + sep)) return false;

	try {
		const info = await stat(target);
		if (!info.isFile()) return false;
		const body = await readFile(target);
		response.writeHead(200, { "content-type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream" });
		response.end(body);
		return true;
	} catch {
		return false;
	}
}
