import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const actionEntrypoint = path.join(repoRoot, "action", "index.js");
const compiledEntrypoint = path.join(repoRoot, "dist", "action", "index.js");

execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], {
  cwd: repoRoot,
  stdio: "inherit",
});

const compiled = fs.readFileSync(compiledEntrypoint, "utf8");
const generated = execFileSync(
  "biome",
  ["check", "--write", "--stdin-file-path", actionEntrypoint],
  {
    cwd: repoRoot,
    encoding: "utf8",
    input:
      "// This file is generated from `src/action/index.ts`; do not edit it directly.\n" +
      compiled,
  },
);

fs.writeFileSync(actionEntrypoint, generated, "utf8");
