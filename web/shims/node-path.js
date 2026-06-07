/**
 * POSIX-style path shim for the browser verifier. Only the functions verify.ts
 * and fixture-source.ts use: resolve, join, dirname, basename, extname. cwd is
 * "/" so resolve(".", "..", "fixtures") deterministically yields "/fixtures",
 * which is where the browser entry loads the fixture candles.
 */

function normalize(parts) {
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out;
}

export function resolve(...segments) {
  // Walk right-to-left, stop once a segment is absolute, else anchor at cwd "/".
  let collected = [];
  let absolute = false;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = String(segments[i] ?? "");
    if (seg === "") continue;
    collected = seg.split("/").concat(collected);
    if (seg.startsWith("/")) {
      absolute = true;
      break;
    }
  }
  const norm = normalize(collected);
  return "/" + norm.join("/"); // cwd is "/", so non-absolute also anchors here
}

export function join(...segments) {
  const joined = segments.filter((s) => s != null && s !== "").join("/");
  const norm = normalize(joined.split("/"));
  const prefix = joined.startsWith("/") ? "/" : "";
  return prefix + norm.join("/") || ".";
}

export function dirname(p) {
  const s = String(p).replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return s.slice(0, i);
}

export function basename(p, ext) {
  let s = String(p).replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  if (i >= 0) s = s.slice(i + 1);
  if (ext && s.endsWith(ext)) s = s.slice(0, s.length - ext.length);
  return s;
}

export function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i) : "";
}

export default { resolve, join, dirname, basename, extname };
