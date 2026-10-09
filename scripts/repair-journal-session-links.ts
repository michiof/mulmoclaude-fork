// Manual one-off (#3417): rewrites session links in existing journal summaries that were written as
// `/chat/<id>.jsonl` and therefore resolve to `<workspace>/chat/`, which does not exist.
// Usage: yarn journal:repair-links [--dry-run] [--workspace <dir>]

import path from "node:path";
import fsp from "node:fs/promises";
import { errorMessage } from "../server/utils/errors.js";
import { writeFileAtomic } from "../server/utils/files/atomic.js";
import { WORKSPACE_DIRS, workspacePath } from "../server/workspace/paths.js";
import { repairSessionLinks } from "../server/workspace/journal/sessionLinkRepair.js";

const JSONL_SUFFIX = ".jsonl";

function parseWorkspaceArg(argv: string[]): string {
  const flagIndex = argv.indexOf("--workspace");
  const value = flagIndex === -1 ? undefined : argv[flagIndex + 1];
  return value === undefined ? workspacePath : path.resolve(value);
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? listMarkdownFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)])),
  );
  return nested.flat().filter((filePath) => filePath.endsWith(".md"));
}

async function loadSessionIds(workspaceRoot: string): Promise<Set<string>> {
  const names = await fsp.readdir(path.join(workspaceRoot, WORKSPACE_DIRS.chat));
  return new Set(names.filter((name) => name.endsWith(JSONL_SUFFIX)).map((name) => name.slice(0, -JSONL_SUFFIX.length)));
}

async function repairFile(workspaceRoot: string, filePath: string, sessionIds: Set<string>, dryRun: boolean): Promise<number> {
  const original = await fsp.readFile(filePath, "utf-8");
  const wsPath = path.relative(workspaceRoot, filePath).split(path.sep).join("/");
  const { content, repairedCount } = repairSessionLinks(wsPath, original, (sessionId) => sessionIds.has(sessionId));
  if (repairedCount === 0) return 0;
  console.log(`${dryRun ? "would repair" : "repaired"} ${repairedCount} link(s) in ${wsPath}`);
  if (!dryRun) await writeFileAtomic(filePath, content);
  return repairedCount;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const workspaceRoot = parseWorkspaceArg(process.argv);
  const sessionIds = await loadSessionIds(workspaceRoot);
  const files = await listMarkdownFiles(path.join(workspaceRoot, WORKSPACE_DIRS.summaries));
  const counts = await Promise.all(files.map((filePath) => repairFile(workspaceRoot, filePath, sessionIds, dryRun)));
  const total = counts.reduce((sum, count) => sum + count, 0);
  console.log(
    `journal:repair-links — ${dryRun ? "would repair" : "repaired"} ${total} link(s) in ${counts.filter((count) => count > 0).length} file(s) (${files.length} scanned)`,
  );
}

main().catch((err) => {
  console.error(`journal:repair-links — failed: ${errorMessage(err)}`);
  process.exitCode = 1;
});
