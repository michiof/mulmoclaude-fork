import path from "node:path";
import { rewriteMarkdownLinks, splitFragmentAndQuery } from "../../utils/markdown.js";
import { WORKSPACE_DIRS } from "../paths.js";

const JSONL_SUFFIX = ".jsonl";
// Where summaries written before the prompt fix resolved their session links to.
const MISCOUNTED_CHAT_DIR = "chat";

export interface SessionLinkRepairResult {
  content: string;
  repairedCount: number;
}

// Session id when `resolvedPath` is exactly `chat/<id>.jsonl` at the workspace root.
export function extractMiscountedSessionId(resolvedPath: string): string | null {
  const prefix = `${MISCOUNTED_CHAT_DIR}/`;
  if (!resolvedPath.startsWith(prefix) || !resolvedPath.endsWith(JSONL_SUFFIX)) return null;
  const sessionId = resolvedPath.slice(prefix.length, resolvedPath.length - JSONL_SUFFIX.length);
  return sessionId.length === 0 || sessionId.includes("/") ? null : sessionId;
}

function repairHref(href: string, currentDir: string, sessionExists: (sessionId: string) => boolean): string | null {
  const { pathPart, suffix } = splitFragmentAndQuery(href);
  if (pathPart.startsWith("/") || pathPart.includes("://")) return null;
  const sessionId = extractMiscountedSessionId(path.posix.join(currentDir, pathPart));
  if (sessionId === null || !sessionExists(sessionId)) return null;
  const target = `${WORKSPACE_DIRS.chat}/${sessionId}${JSONL_SUFFIX}`;
  return `${path.posix.relative(currentDir, target)}${suffix}`;
}

const FENCE_CHARS = ["`", "~"];
const MIN_FENCE_LENGTH = 3;
const MAX_FENCE_INDENT = 3;
const BACKTICK = "`";

// Splits a line into prose and inline-code segments; an unmatched backtick run is plain prose.
function splitInlineCode(line: string): { text: string; isCode: boolean }[] {
  const segments: { text: string; isCode: boolean }[] = [];
  let proseStart = 0;
  let index = 0;
  while (index < line.length) {
    if (line[index] !== BACKTICK) {
      index += 1;
      continue;
    }
    const runLength = backtickRunLength(line, index);
    const closeIndex = findClosingRun(line, index + runLength, runLength);
    if (closeIndex === -1) {
      index += runLength;
      continue;
    }
    if (index > proseStart) segments.push({ text: line.slice(proseStart, index), isCode: false });
    segments.push({ text: line.slice(index, closeIndex + runLength), isCode: true });
    proseStart = closeIndex + runLength;
    index = proseStart;
  }
  if (proseStart < line.length) segments.push({ text: line.slice(proseStart), isCode: false });
  return segments;
}

function backtickRunLength(line: string, from: number): number {
  let end = from;
  while (line[end] === BACKTICK) end += 1;
  return end - from;
}

function findClosingRun(line: string, from: number, runLength: number): number {
  let index = from;
  while (index < line.length) {
    if (line[index] !== BACKTICK) {
      index += 1;
      continue;
    }
    const length = backtickRunLength(line, index);
    if (length === runLength) return index;
    index += length;
  }
  return -1;
}

interface FenceLine {
  char: string;
  length: number;
  rest: string;
}

// CommonMark fence line: up to three spaces of indent, then a run of at least three backticks or tildes.
function parseFenceLine(line: string): FenceLine | null {
  const indent = line.length - line.trimStart().length;
  const body = line.slice(indent);
  const [char] = body;
  if (indent > MAX_FENCE_INDENT || char === undefined || !FENCE_CHARS.includes(char)) return null;
  let length = 0;
  while (body[length] === char) length += 1;
  return length < MIN_FENCE_LENGTH ? null : { char, length, rest: body.slice(length) };
}

function opensFence(line: string): FenceLine | null {
  const fence = parseFenceLine(line);
  // A backtick fence's info string may not contain a backtick, otherwise the line is inline code.
  return fence !== null && fence.char === BACKTICK && fence.rest.includes(BACKTICK) ? null : fence;
}

function closesFence(line: string, open: FenceLine): boolean {
  const fence = parseFenceLine(line);
  return fence !== null && fence.char === open.char && fence.length >= open.length && fence.rest.trim() === "";
}

// Applies `repairProse` to every line outside fenced code and every segment outside inline code.
function mapProseOnly(content: string, repairProse: (prose: string) => string): string {
  let openFence: FenceLine | null = null;
  return content
    .split("\n")
    .map((line) => {
      if (openFence !== null) {
        if (closesFence(line, openFence)) openFence = null;
        return line;
      }
      openFence = opensFence(line);
      if (openFence !== null) return line;
      return splitInlineCode(line)
        .map((segment) => (segment.isCode ? segment.text : repairProse(segment.text)))
        .join("");
    })
    .join("\n");
}

// Points links that resolve to `<workspace>/chat/<id>.jsonl` at the real `conversations/chat/<id>.jsonl`.
// A link is left alone when the session file exists in neither place, so links to deleted sessions are not touched.
// Supported form: single-line inline links `[text](href)` in prose. Fenced code, inline code, titled links
// (`[t](href "title")`), reference-style and angle-bracket links are left exactly as written.
export function repairSessionLinks(fileWsPath: string, content: string, sessionExists: (sessionId: string) => boolean): SessionLinkRepairResult {
  const currentDir = path.posix.dirname(fileWsPath);
  let repairedCount = 0;
  const repaired = mapProseOnly(content, (prose) =>
    rewriteMarkdownLinks(prose, (href) => {
      const fixed = repairHref(href, currentDir, sessionExists);
      if (fixed === null) return href;
      repairedCount += 1;
      return fixed;
    }),
  );
  return { content: repaired, repairedCount };
}
