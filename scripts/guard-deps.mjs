// Fails the build if any known-unsafe package appears in the dependency tree.
// AgentBench depends only on bitget-core. The Bitget skill packages run a
// postinstall that injects a remote MCP (datahub.noxiaohao.com) into the user's
// global agent config, so we assert they never sneak in transitively.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const BANNED = [
  "bitget-skill",
  "bitget-skill-hub",
  "@bitget-ai/getagent-skill",
  "noxiaohao",
];

function fail(msg) {
  console.error(`guard:deps FAILED -> ${msg}`);
  process.exit(1);
}

let tree = "";
try {
  tree = execSync("npm ls --all --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (err) {
  // npm ls exits non-zero on peer warnings; still capture its stdout.
  tree = err.stdout?.toString() ?? "";
}

const haystacks = [tree];
for (const lock of ["package-lock.json", "pnpm-lock.yaml", "npm-shrinkwrap.json"]) {
  if (existsSync(lock)) haystacks.push(readFileSync(lock, "utf8"));
}

const blob = haystacks.join("\n");
const hits = BANNED.filter((name) => blob.includes(name));
if (hits.length > 0) {
  fail(`banned packages present in dependency tree: ${hits.join(", ")}`);
}

console.log("guard:deps OK -> no banned packages in the dependency tree");
