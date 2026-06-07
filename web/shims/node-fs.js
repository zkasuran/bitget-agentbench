/**
 * Synchronous in-memory filesystem for the browser verifier.
 *
 * The real verify.ts reads files synchronously (readFileSync, existsSync, ...).
 * The browser cannot read synchronously over the network, so the page fetches
 * every file a report needs up front (async), loads them here, then calls the
 * real verifyReport, which reads them synchronously from this map. No verifier
 * code changes: it runs verbatim against this fs.
 *
 * Paths are normalised to a canonical absolute-style form so the verifier's
 * resolve/join/dirname (from the node-path shim) line up with what we loaded.
 */

const files = new Map(); // path -> string contents
const dirs = new Set(); // known directory paths

function norm(p) {
  // Collapse "a/b/../c" and strip a leading "./". The verifier never uses
  // symlinks or absolute OS paths in the browser, so this is enough.
  const parts = String(p).split("/");
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

export function reset() {
  files.clear();
  dirs.clear();
}

export function loadFile(path, contents) {
  const p = norm(path);
  files.set(p, contents);
  // Register every ancestor directory.
  let dir = p.slice(0, p.lastIndexOf("/"));
  while (dir.length > 0) {
    dirs.add(dir);
    dir = dir.slice(0, dir.lastIndexOf("/"));
  }
  dirs.add("/");
}

export function readFileSync(path, _encoding) {
  const p = norm(path);
  if (!files.has(p)) {
    const err = new Error(`ENOENT: no such file, open '${p}'`);
    err.code = "ENOENT";
    throw err;
  }
  return files.get(p);
}

export function existsSync(path) {
  const p = norm(path);
  return files.has(p) || dirs.has(p);
}

export function statSync(path) {
  const p = norm(path);
  const isDir = dirs.has(p) && !files.has(p);
  return { isDirectory: () => isDir, isFile: () => files.has(p) };
}

export function readdirSync(path) {
  const p = norm(path);
  const prefix = p === "/" ? "/" : p + "/";
  const names = new Set();
  for (const f of files.keys()) {
    if (f.startsWith(prefix)) {
      const rest = f.slice(prefix.length);
      const name = rest.split("/")[0];
      if (name) names.add(name);
    }
  }
  return [...names];
}

// Writers are unused by verify, present so the bundle never crashes if touched.
export function writeFileSync() {
  throw new Error("node-fs shim is read-only in the browser");
}
export function mkdirSync() {}
export function realpathSync(p) {
  return norm(p);
}

export default {
  readFileSync,
  existsSync,
  statSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
};
