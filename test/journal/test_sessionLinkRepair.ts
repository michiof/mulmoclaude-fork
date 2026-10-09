import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractMiscountedSessionId, repairSessionLinks } from "../../server/workspace/journal/sessionLinkRepair.js";

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";
const existing = (sessionId: string): boolean => sessionId === SESSION_ID;

describe("extractMiscountedSessionId", () => {
  it("accepts chat/<id>.jsonl only", () => {
    assert.equal(extractMiscountedSessionId("chat/abc.jsonl"), "abc");
    assert.equal(extractMiscountedSessionId("conversations/chat/abc.jsonl"), null);
    assert.equal(extractMiscountedSessionId("chat/sub/abc.jsonl"), null);
    assert.equal(extractMiscountedSessionId("chat/.jsonl"), null);
    assert.equal(extractMiscountedSessionId("chat/abc.md"), null);
  });
});

describe("repairSessionLinks", () => {
  it("repairs a daily summary link that resolved to <workspace>/chat", () => {
    const content = `see [session 550e8400](../../../../../chat/${SESSION_ID}.jsonl) here`;
    const result = repairSessionLinks("conversations/summaries/daily/2026/09/30.md", content, existing);
    assert.equal(result.content, `see [session 550e8400](../../../../chat/${SESSION_ID}.jsonl) here`);
    assert.equal(result.repairedCount, 1);
  });

  it("computes the depth per directory (topics, archive)", () => {
    const topics = repairSessionLinks("conversations/summaries/topics/foo.md", `[s](../../../chat/${SESSION_ID}.jsonl)`, existing);
    assert.equal(topics.content, `[s](../../chat/${SESSION_ID}.jsonl)`);
    const archive = repairSessionLinks("conversations/summaries/archive/topics/foo.md", `[s](../../../../chat/${SESSION_ID}.jsonl)`, existing);
    assert.equal(archive.content, `[s](../../../chat/${SESSION_ID}.jsonl)`);
  });

  it("keeps the fragment and query", () => {
    const result = repairSessionLinks("conversations/summaries/topics/foo.md", `[s](../../../chat/${SESSION_ID}.jsonl#L3)`, existing);
    assert.equal(result.content, `[s](../../chat/${SESSION_ID}.jsonl#L3)`);
  });

  it("leaves links to sessions that exist nowhere", () => {
    const content = "[s](../../../chat/deleted.jsonl)";
    assert.deepEqual(repairSessionLinks("conversations/summaries/topics/foo.md", content, existing), { content, repairedCount: 0 });
  });

  it("leaves already-correct, external and unrelated links", () => {
    const content = [
      `[a](../../chat/${SESSION_ID}.jsonl)`,
      `[b](https://example.com/chat/${SESSION_ID}.jsonl)`,
      "[c](../../../data/wiki/pages/x.md)",
      `[d](/chat/${SESSION_ID}.jsonl)`,
    ].join("\n");
    assert.deepEqual(repairSessionLinks("conversations/summaries/topics/foo.md", content, existing), { content, repairedCount: 0 });
  });

  it("is idempotent", () => {
    const first = repairSessionLinks("conversations/summaries/topics/foo.md", `[s](../../../chat/${SESSION_ID}.jsonl)`, existing);
    assert.equal(repairSessionLinks("conversations/summaries/topics/foo.md", first.content, existing).repairedCount, 0);
  });

  it("does not touch a link that escapes the workspace", () => {
    const content = `[s](../../../../../../chat/${SESSION_ID}.jsonl)`;
    assert.equal(repairSessionLinks("conversations/summaries/topics/foo.md", content, existing).repairedCount, 0);
  });
});
