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

// Points links that resolve to `<workspace>/chat/<id>.jsonl` at the real `conversations/chat/<id>.jsonl`.
// A link is left alone when the session file exists in neither place, so links to deleted sessions are not touched.
export function repairSessionLinks(fileWsPath: string, content: string, sessionExists: (sessionId: string) => boolean): SessionLinkRepairResult {
  const currentDir = path.posix.dirname(fileWsPath);
  let repairedCount = 0;
  const repaired = rewriteMarkdownLinks(content, (href) => {
    const fixed = repairHref(href, currentDir, sessionExists);
    if (fixed === null) return href;
    repairedCount += 1;
    return fixed;
  });
  return { content: repaired, repairedCount };
}
