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
    assert.deepEqual(repairSessionLinks("conversations/summaries/topics/foo.md", content, existing), { content, repairedCount: 0, skippedCount: 0 });
  });

  it("leaves already-correct, external and unrelated links", () => {
    const content = [
      `[a](../../chat/${SESSION_ID}.jsonl)`,
      `[b](https://example.com/chat/${SESSION_ID}.jsonl)`,
      "[c](../../../data/wiki/pages/x.md)",
      `[d](/chat/${SESSION_ID}.jsonl)`,
    ].join("\n");
    assert.deepEqual(repairSessionLinks("conversations/summaries/topics/foo.md", content, existing), { content, repairedCount: 0, skippedCount: 0 });
  });

  it("is idempotent", () => {
    const first = repairSessionLinks("conversations/summaries/topics/foo.md", `[s](../../../chat/${SESSION_ID}.jsonl)`, existing);
    assert.equal(repairSessionLinks("conversations/summaries/topics/foo.md", first.content, existing).repairedCount, 0);
  });

  it("does not touch a link that escapes the workspace", () => {
    const content = `[s](../../../../../../chat/${SESSION_ID}.jsonl)`;
    assert.equal(repairSessionLinks("conversations/summaries/topics/foo.md", content, existing).repairedCount, 0);
  });

  const BROKEN = `[s](../../../chat/${SESSION_ID}.jsonl)`;
  const FIXED = `[s](../../chat/${SESSION_ID}.jsonl)`;
  const TOPIC_FILE = "conversations/summaries/topics/foo.md";

  it("leaves inline code spans untouched, including spans that cross lines", () => {
    const spans = [`\`${BROKEN}\``, `\`opens here\n${BROKEN}\nand closes here\``, `\`\`a \` ${BROKEN} b\`\``, `\`one\` \`${BROKEN}\``];
    spans.forEach((span) => {
      const result = repairSessionLinks(TOPIC_FILE, span, existing);
      assert.equal(result.content, span, span);
      assert.equal(result.repairedCount, 0, span);
    });
  });

  it("repairs a link beside inline code, before a later span, and after a span that closed", () => {
    const content = `a \`x\` ${BROKEN} b \`y\`\n- \`z\` ${BROKEN}\nlone \` tick ${BROKEN}`;
    const result = repairSessionLinks(TOPIC_FILE, content, existing);
    assert.equal(result.content, `a \`x\` ${FIXED} b \`y\`\n- \`z\` ${FIXED}\nlone \` tick ${FIXED}`);
  });

  it("leaves paragraphs with raw HTML or an indented-code start, and counts the broken links skipped", () => {
    const paragraphs = [`<code>${BROKEN}</code>`, `    ${BROKEN}`, `\t${BROKEN}`, `${BROKEN} <br>`];
    paragraphs.forEach((paragraph) => {
      const result = repairSessionLinks(TOPIC_FILE, paragraph, existing);
      assert.equal(result.content, paragraph, paragraph);
      assert.deepEqual([result.repairedCount, result.skippedCount], [0, 1], paragraph);
    });
  });

  it("leaves titled links as written", () => {
    const titled = `[t](../../../chat/${SESSION_ID}.jsonl "title")`;
    assert.deepEqual(repairSessionLinks(TOPIC_FILE, titled, existing), { content: titled, repairedCount: 0, skippedCount: 0 });
  });

  it("repairs plain paragraphs around an HTML paragraph and keeps blank lines and CRLF", () => {
    const content = [BROKEN, "", `<b>x</b> ${BROKEN}`, "", `${BROKEN} text`].join("\r\n");
    const result = repairSessionLinks(TOPIC_FILE, content, existing);
    assert.equal(result.content, [FIXED, "", `<b>x</b> ${BROKEN}`, "", `${FIXED} text`].join("\r\n"));
    assert.deepEqual([result.repairedCount, result.skippedCount], [2, 1]);
  });

  it("leaves fenced code alone and resumes repairing after the closing fence", () => {
    const content = ["```", BROKEN, "```", BROKEN].join("\n");
    assert.equal(repairSessionLinks(TOPIC_FILE, content, existing).content, ["```", BROKEN, "```", FIXED].join("\n"));
    const tilde = ["~~~md", BROKEN, "~~~"].join("\n");
    assert.equal(repairSessionLinks(TOPIC_FILE, tilde, existing).repairedCount, 0);
  });

  it("follows CommonMark fence rules: longer openers, closers with trailing text, deep indent", () => {
    const dir = TOPIC_FILE;
    const longer = ["````", BROKEN, "```", BROKEN, "````", BROKEN].join("\n");
    assert.equal(repairSessionLinks(dir, longer, existing).content, ["````", BROKEN, "```", BROKEN, "````", FIXED].join("\n"));
    const trailing = ["```", BROKEN, "``` not a close", BROKEN, "```", BROKEN].join("\n");
    assert.equal(repairSessionLinks(dir, trailing, existing).content, ["```", BROKEN, "``` not a close", BROKEN, "```", FIXED].join("\n"));
    const longCloser = ["```", BROKEN, "`````", BROKEN].join("\n");
    assert.equal(repairSessionLinks(dir, longCloser, existing).content, ["```", BROKEN, "`````", FIXED].join("\n"));
    const unclosed = ["```", BROKEN, BROKEN].join("\n");
    assert.equal(repairSessionLinks(dir, unclosed, existing).repairedCount, 0);
  });

  it("is idempotent on mixed content", () => {
    const content = [BROKEN, "", `<b>c</b> ${BROKEN}`, "```", BROKEN, "```"].join("\n");
    const first = repairSessionLinks(TOPIC_FILE, content, existing);
    assert.deepEqual(repairSessionLinks(TOPIC_FILE, first.content, existing), { content: first.content, repairedCount: 0, skippedCount: 1 });
  });

  it("leaves raw HTML blocks that span blank lines untouched, counts their broken links, then resumes", () => {
    const dir = TOPIC_FILE;
    const blocks = [
      ["<script>", "", BROKEN, "", "</script>"],
      ["<PRE class=x>", "", BROKEN, "", "</Pre>"],
      ["<style>", "", BROKEN, "</style>"],
      ["<!--", "", BROKEN, "", "-->"],
      ["<?php", "", BROKEN, "", "?>"],
      ["<![CDATA[", "", BROKEN, "", "]]>"],
      ["<!DOCTYPE", "", BROKEN, "", "html>"],
    ];
    blocks.forEach((block) => {
      const html = block.join("\n");
      const result = repairSessionLinks(dir, [html, "", BROKEN].join("\n"), existing);
      assert.equal(result.content, [html, "", FIXED].join("\n"), html);
      assert.deepEqual([result.repairedCount, result.skippedCount], [1, 1], html);
    });
  });

  it("an unclosed raw HTML block protects the rest of the file; a block closed on its opening line does not", () => {
    const unclosed = ["<script>", "", BROKEN, "", BROKEN].join("\n");
    assert.deepEqual(repairSessionLinks(TOPIC_FILE, unclosed, existing).repairedCount, 0);
    const oneLine = ["<!-- note -->", "", BROKEN].join("\n");
    assert.equal(repairSessionLinks(TOPIC_FILE, oneLine, existing).content, ["<!-- note -->", "", FIXED].join("\n"));
  });

  it("does not treat tags that merely start with a raw-text name as a spanning block", () => {
    const content = ["<scripty>", "", BROKEN].join("\n");
    assert.equal(repairSessionLinks(TOPIC_FILE, content, existing).content, ["<scripty>", "", FIXED].join("\n"));
  });
});
