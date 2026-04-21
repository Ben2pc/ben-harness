import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, after } from "node:test";

// Covers the "invokedAsScript" guard regression caught by claude-review
// (Opus) on PR #31:
//   - `process.argv[1].endsWith("cli.js")` false-negatived when the CLI
//     was executed via a symlink (e.g., `node_modules/.bin/auriga-cli`),
//     because argv[1] is the *symlink* path (basename has no cli.js
//     suffix). `main()` never ran → the published CLI was a no-op on
//     every non-Windows install.
// Spawn the built dist/cli.js both directly and via a symlink, assert
// both paths print the version — prevents the regression from returning.
describe("script entrypoint — symlinked bin install (Opus review finding)", () => {
  const CLI_JS = path.resolve("dist", "cli.js");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-entry-"));
  const symlink = path.join(scratch, "auriga-cli");

  after(() => {
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
  });

  test("dist/cli.js must exist (npm run build succeeded)", () => {
    assert.ok(fs.existsSync(CLI_JS), `expected ${CLI_JS} to exist`);
  });

  test("direct invocation: node dist/cli.js --version prints version", () => {
    const result = spawnSync(process.execPath, [CLI_JS, "--version"], {
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /^\d+\.\d+\.\d+/);
  });

  test("symlinked invocation: ln -s dist/cli.js auriga-cli && ./auriga-cli --version also prints version", () => {
    // Simulates what `npm install -g` does: creates a symlink in bin/
    // pointing at dist/cli.js. Node follows the shebang via the symlink
    // and passes the symlink path as argv[1] — the broken `endsWith`
    // check would false-negative here.
    fs.symlinkSync(CLI_JS, symlink);
    const result = spawnSync(process.execPath, [symlink, "--version"], {
      encoding: "utf-8",
    });
    assert.equal(
      result.status,
      0,
      `invokedAsScript guard mis-rejected symlinked entrypoint. stdout="${result.stdout}" stderr="${result.stderr}"`,
    );
    assert.match(
      result.stdout,
      /^\d+\.\d+\.\d+/,
      `expected version output; got "${result.stdout}"`,
    );
  });
});
