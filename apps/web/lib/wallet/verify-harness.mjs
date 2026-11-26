// T7.2b — Zero-dependency local HTTP server for manual browser verification of the CIP-30 wallet helper.
// Binds only to 127.0.0.1 and serves only allowlisted files in apps/web/lib/wallet/.
// Strips TypeScript types on the fly via Node's built-in module.stripTypeScriptTypes so the browser
// runs the exact source files without adding dependencies or build artifacts.
// Never submits transactions or reads secrets.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const HOST = "127.0.0.1";

const ALLOWED_FILES = new Map([
  ["/", { file: "verify.html", contentType: "text/html; charset=utf-8", stripTs: false }],
  ["/verify.html", { file: "verify.html", contentType: "text/html; charset=utf-8", stripTs: false }],
  ["/index.ts", { file: "index.ts", contentType: "text/javascript; charset=utf-8", stripTs: true }],
  ["/wallet.ts", { file: "wallet.ts", contentType: "text/javascript; charset=utf-8", stripTs: true }],
  ["/bech32.ts", { file: "bech32.ts", contentType: "text/javascript; charset=utf-8", stripTs: true }],
  ["/types.ts", { file: "types.ts", contentType: "text/javascript; charset=utf-8", stripTs: true }],
]);

const server = createServer(async (req, res) => {
  const urlPath = new URL(req.url ?? "/", `http://${HOST}:${PORT}`).pathname;
  const entry = ALLOWED_FILES.get(urlPath);

  if (!entry) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  try {
    const source = await readFile(path.join(DIR, entry.file), "utf8");
    const body = entry.stripTs ? stripTypeScriptTypes(source) : source;
    res.writeHead(200, {
      "Content-Type": entry.contentType,
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Failed to serve ${entry.file}: ${err instanceof Error ? err.message : String(err)}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`T7.2b wallet verification harness running at http://${HOST}:${PORT}`);
  console.log("Use Lace or Eternl switched to Cardano Preprod testnet (test ADA has no monetary value).");
  console.log("This harness signs only and NEVER submits transactions. Press Ctrl+C to stop.");
});
