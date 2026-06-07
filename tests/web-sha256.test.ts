import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error - plain JS shim, no types
import { sha256Hex, Sha256 } from "../web/shims/sha256.js";
// @ts-expect-error - plain JS shim, no types
import { createHash as shimCreateHash } from "../web/shims/node-crypto.js";
import { computeScorecardSha256 } from "../src/report/hash.js";
import { hashDataset } from "../src/report/emit.js";
import { loadFixture } from "../src/sources/fixture-source.js";

/**
 * No-drift gate for the browser verifier. The web page hashes in pure JS, the
 * CLI hashes with node:crypto. If these ever diverge, the page can show PASS
 * where the CLI shows FAIL, which would be the worst possible bug in a
 * verification product. This test must stay green or the web build does not ship.
 */

const nodeSha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("web sha256 shim matches node:crypto", () => {
  it("agrees on empty and known vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("agrees on multi-byte UTF-8 and long inputs", () => {
    const cases = [
      "BTCUSDT",
      "price,funding,oi → signal",
      "x".repeat(1),
      "y".repeat(55), // one byte under a block boundary
      "z".repeat(56), // forces an extra padding block
      "w".repeat(64), // exact block
      "q".repeat(1000),
      JSON.stringify({ a: 1, b: [2, 3], c: "ünïcøde" }),
    ];
    for (const c of cases) {
      expect(sha256Hex(c)).toBe(nodeSha(c));
    }
  });

  it("incremental update matches a single update", () => {
    const split = new Sha256().update("hello ").update("world").digest();
    const whole = sha256Hex("hello world");
    expect(split).toBe(whole);
    expect(whole).toBe(nodeSha("hello world"));
  });

  it("the crypto shim createHash mirrors node:crypto", () => {
    const s = "verify-by-recompute";
    expect(shimCreateHash("sha256").update(s).digest("hex")).toBe(nodeSha(s));
  });
});

describe("real verifier hashes reproduce through the shim", () => {
  const reportsDir = join(__dirname, "..", "reports");
  const reportDirs = readdirSync(reportsDir).filter((n) =>
    existsSync(join(reportsDir, n, "scorecard.json")),
  );

  it("found committed reports to check", () => {
    expect(reportDirs.length).toBeGreaterThan(0);
  });

  for (const name of reportDirs) {
    it(`scorecard + dataset hash match node for ${name}`, () => {
      const scorecard = JSON.parse(
        readFileSync(join(reportsDir, name, "scorecard.json"), "utf8"),
      );
      // The content hash the CLI computes, recomputed, must equal the one in the
      // file. computeScorecardSha256 uses node:crypto here; the shim must agree
      // on the identical canonical bytes.
      const canonical = canonicalOf(scorecard);
      expect(sha256Hex(canonical)).toBe(nodeSha(canonical));

      // Dataset hash over the exact fixture candles, line by line as hashDataset
      // builds them, must agree between shim and node.
      const m = scorecard.manifest;
      if (m.source === "fixture") {
        const bars = loadFixture(m.symbol, m.granularity);
        const datasetBytes = bars
          .map(
            (b) =>
              `${b.time},${b.open},${b.high},${b.low},${b.close},${b.volume}\n`,
          )
          .join("");
        expect(sha256Hex(datasetBytes)).toBe(nodeSha(datasetBytes));
        expect(sha256Hex(datasetBytes)).toBe(hashDataset(bars));
      }

      // And the canonical scorecard hash equals computeScorecardSha256 (node path).
      expect(sha256Hex(canonical)).toBe(
        computeScorecardSha256(scorecard),
      );
    });
  }
});

// Mirror src/report/hash.ts canonicalJson over {agent, metrics, manifest}.
function canonicalOf(scorecard: {
  agent: unknown;
  metrics: unknown;
  manifest: unknown;
}): string {
  const { agent, metrics, manifest } = scorecard;
  return JSON.stringify(sortKeys({ agent, metrics, manifest }));
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}
