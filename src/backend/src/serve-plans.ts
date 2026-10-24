#!/usr/bin/env bun
/**
 * Static HTTP file server for `plans/*.json`.
 *
 * Why this exists: the CRE workflow runs in QuickJS (no fs), so the plan file
 * has to arrive over HTTP for the workflow to hash its raw bytes. This is the
 * demo-stage stand-in for object storage / IPFS (README §9.7) — same bytes, same
 * hash, just served from disk instead of a bucket.
 *
 *   bun run serve:plans                 # plans/ on http://127.0.0.1:8788
 *   PLANS_PORT=9000 bun run serve:plans
 *
 * Serves the file's exact bytes: no JSON re-encoding, no pretty-print, no
 * trailing newline changes. Whatever the workflow fetches is what `cast keccak`
 * sees on disk.
 */
const dir = process.env.PLANS_DIR ?? "plans";
const host = process.env.PLANS_HOST ?? "127.0.0.1";
const port = Number(process.env.PLANS_PORT ?? 8788);

/** Flat filenames only: `<planId>.json`, no path segments, no traversal. */
const PLAN_FILE = /^[A-Za-z0-9._:@+-]+\.json$/;

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") return new Response("ok\n", { headers: { "content-type": "text/plain" } });

    const name = decodeURIComponent(pathname.replace(/^\/+/, ""));
    if (!PLAN_FILE.test(name) || name.includes("..")) {
      return new Response("not found\n", { status: 404 });
    }

    const file = Bun.file(`${dir}/${name}`);
    if (!(await file.exists())) return new Response("not found\n", { status: 404 });

    return new Response(file, {
      headers: {
        "content-type": "application/json",
        // The hash is the point: never let a cache hand back older bytes.
        "cache-control": "no-store",
      },
    });
  },
});

console.log(`serve:plans  ${dir}/  →  http://${host}:${server.port}/<planId>.json`);
