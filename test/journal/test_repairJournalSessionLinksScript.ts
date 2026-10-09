import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsSync from "node:fs";
import osModule from "node:os";
import path from "node:path";

const SCRIPT_PATH = path.resolve("scripts", "repair-journal-session-links.ts");
const SESSION_ID = "aaa";
const BROKEN_LINK = `[s](../../../chat/${SESSION_ID}.jsonl)`;
const FIXED_LINK = `[s](../../chat/${SESSION_ID}.jsonl)`;

function runScript(workspace: string, ...flags: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx", SCRIPT_PATH, "--workspace", workspace, ...flags], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("repair-journal-session-links script", () => {
  let workspace = "";
  let topicFile = "";
  let binaryFile = "";
  const binaryBytes = Buffer.concat([Buffer.from("ok "), Buffer.from([0xff, 0xfe]), Buffer.from(` ${BROKEN_LINK}\n`)]);

  before(() => {
    workspace = fsSync.mkdtempSync(path.join(osModule.tmpdir(), "repair-links-"));
    fsSync.mkdirSync(path.join(workspace, "conversations", "chat"), { recursive: true });
    fsSync.mkdirSync(path.join(workspace, "conversations", "summaries", "topics"), { recursive: true });
    fsSync.writeFileSync(path.join(workspace, "conversations", "chat", `${SESSION_ID}.jsonl`), "");
    topicFile = path.join(workspace, "conversations", "summaries", "topics", "t.md");
    binaryFile = path.join(workspace, "conversations", "summaries", "topics", "bin.md");
    fsSync.writeFileSync(topicFile, `${BROKEN_LINK}\n`);
    fsSync.writeFileSync(binaryFile, binaryBytes);
  });

  after(() => fsSync.rmSync(workspace, { recursive: true, force: true }));

  it("dry run writes nothing, a real run repairs, a second run changes nothing", () => {
    assert.match(runScript(workspace, "--dry-run"), /would repair 1 link/);
    assert.equal(fsSync.readFileSync(topicFile, "utf-8"), `${BROKEN_LINK}\n`);
    assert.match(runScript(workspace), /repaired 1 link/);
    assert.equal(fsSync.readFileSync(topicFile, "utf-8"), `${FIXED_LINK}\n`);
    assert.match(runScript(workspace), /repaired 0 link/);
  });

  it("leaves a file that is not valid UTF-8 byte-for-byte untouched", () => {
    assert.ok(fsSync.readFileSync(binaryFile).equals(binaryBytes));
  });
});
