# fix: script to repair legacy journal session links (#3417)

Follow-up to #3415 / #3416. Summaries written before the prompt fix link sessions through a path that resolves to `<workspace>/chat/<id>.jsonl`, which does not exist.

- `server/workspace/journal/sessionLinkRepair.ts` — pure: rewrites a link only when it resolves to `chat/<id>.jsonl` at the workspace root AND the session exists under `conversations/chat/`. The relative path is recomputed per file, so `daily`, `topics` and `archive` each get the right number of `..`.
- `scripts/repair-journal-session-links.ts` — manual, opt-in (`yarn journal:repair-links [--dry-run] [--workspace <dir>]`). Not run at server start because it rewrites user data.
- Idempotent; links to deleted sessions are left alone.
