/**
 * Build the static client-side verifier into docs/ for GitHub Pages.
 *
 * It bundles web/verify-browser.ts with esbuild, aliasing node:fs / node:path /
 * node:crypto to the browser shims in web/shims, so the REAL verifyReport runs
 * in the browser unchanged. Then it copies the page, the committed reports and
 * the fixtures the reports need, and writes a reports-index.json the page reads.
 *
 * Touches nothing the package ships: not src/, not package.json files[], not CI.
 */

import { build } from "esbuild";
import {
  rmSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const shims = join(root, "web", "shims");

// Fresh docs/ each build so nothing stale lingers.
rmSync(docs, { recursive: true, force: true });
mkdirSync(docs, { recursive: true });

// 1. Bundle the verifier with the node:* modules aliased to browser shims.
await build({
  entryPoints: [join(root, "web", "verify-browser.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  outfile: join(docs, "verify.bundle.js"),
  alias: {
    "node:fs": join(shims, "node-fs.js"),
    "node:path": join(shims, "node-path.js"),
    "node:crypto": join(shims, "node-crypto.js"),
  },
  // import.meta.dirname is Node-only; force it undefined so defaultFixtureDir()
  // falls back to "." and resolves fixtures at /fixtures in the browser.
  define: { "import.meta.dirname": "undefined" },
  logLevel: "info",
});

// 2. Copy the page.
cpSync(join(root, "web", "index.html"), join(docs, "index.html"));

// 3. Copy committed reports (scorecard.json, equity.csv, trades.jsonl per dir)
//    and build the index the page lists.
const reportsSrc = join(root, "reports");
const reportNames = readdirSync(reportsSrc).filter((n) =>
  existsSync(join(reportsSrc, n, "scorecard.json")),
);
const index = [];
const neededFixtures = new Set();
for (const name of reportNames) {
  const dst = join(docs, "reports", name);
  mkdirSync(dst, { recursive: true });
  for (const f of ["scorecard.json", "equity.csv", "trades.jsonl", "candles.json"]) {
    const src = join(reportsSrc, name, f);
    if (existsSync(src)) cpSync(src, join(dst, f));
  }
  const sc = JSON.parse(readFileSync(join(reportsSrc, name, "scorecard.json"), "utf8"));
  const m = sc.manifest;
  index.push({
    name,
    symbol: m.symbol,
    granularity: m.granularity,
    agent: sc.agent,
    source: m.source,
  });
  if (m.source === "fixture") {
    neededFixtures.add(`${m.symbol}-${m.granularity}.json`);
  }
}
writeFileSync(join(docs, "reports-index.json"), JSON.stringify(index, null, 2));

// 4. Copy only the fixtures the reports actually need.
mkdirSync(join(docs, "fixtures"), { recursive: true });
for (const f of neededFixtures) {
  cpSync(join(root, "fixtures", f), join(docs, "fixtures", f));
}

// 5. Disable Jekyll so files are served as-is.
writeFileSync(join(docs, ".nojekyll"), "");

console.log(
  `web build: ${reportNames.length} reports, ${neededFixtures.size} fixtures -> docs/`,
);
