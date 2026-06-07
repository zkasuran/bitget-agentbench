/**
 * Browser stand-in for the slice of node:crypto the verifier uses:
 * createHash("sha256").update(...).digest("hex").
 *
 * Backed by the pure-JS Sha256 in ./sha256.js. The no-drift test asserts this
 * produces byte-identical digests to real node:crypto, so the bundled verifier
 * computes the same hashes in the browser as the CLI does on a server.
 */

import { Sha256 } from "./sha256.js";

class Hash {
  constructor(algorithm) {
    if (algorithm !== "sha256") {
      throw new Error(`node-crypto shim only implements sha256, got ${algorithm}`);
    }
    this._h = new Sha256();
  }
  update(data) {
    this._h.update(data);
    return this;
  }
  digest(encoding) {
    if (encoding !== "hex") {
      throw new Error(`node-crypto shim only implements digest("hex"), got ${encoding}`);
    }
    return this._h.digest();
  }
}

export function createHash(algorithm) {
  return new Hash(algorithm);
}

export default { createHash };
