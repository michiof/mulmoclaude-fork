import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createShimCloser, isTrackedShimGroup, killAllShimGroups } from "../../server/agent/stdioHttpShim.js";

const GRACE_MS = 200;
const DEATH_WAIT_MS = 5000;
const POLL_MS = 50;

// wrapper sh → inner sh → sleep: the same shape as npx → sh → supergateway,
// where a SIGTERM to the wrapper alone leaves the grandchild running (#3357).
const PLAIN_TREE = "sh -c 'sleep 60 & echo $!; wait'";
// An ignored signal is inherited, so every level here ignores SIGTERM.
const TERM_IGNORING_TREE = "trap '' TERM; sh -c 'sleep 60 & echo $!; wait'";

const spawnedGroups: number[] = [];

// A failed assertion must not leave detached sleeps running on the CI host.
after(() => {
  spawnedGroups.forEach((pid) => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
  });
});

function spawnTree(script: string = PLAIN_TREE): Promise<{ child: ChildProcess; grandchildPid: number }> {
  const child = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "ignore"], detached: true });
  if (child.pid !== undefined) spawnedGroups.push(child.pid);
  return new Promise((resolve, reject) => {
    child.stdout?.once("data", (chunk: Buffer) => resolve({ child, grandchildPid: Number(chunk.toString().trim()) }));
    child.once("error", reject);
  });
}

// A zombie still answers kill(pid, 0) until it is reaped, but it has exited.
function isAlive(pid: number): boolean {
  try {
    const state = execFileSync("ps", ["-o", "stat=", "-p", String(pid)])
      .toString()
      .trim();
    return state !== "" && !state.startsWith("Z");
  } catch {
    return false;
  }
}

async function waitForDeath(pid: number): Promise<boolean> {
  const deadline = Date.now() + DEATH_WAIT_MS;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

describe("createShimCloser", { skip: process.platform === "win32" }, () => {
  it("ends the grandchild, not just the direct child", async () => {
    const { child, grandchildPid } = await spawnTree();
    const exited = once(child, "exit");
    createShimCloser(child, GRACE_MS)();
    await exited;
    assert.equal(await waitForDeath(grandchildPid), true);
  });

  it("escalates to SIGKILL for a group member that ignores SIGTERM", async () => {
    const { child, grandchildPid } = await spawnTree(TERM_IGNORING_TREE);
    createShimCloser(child, GRACE_MS)();
    assert.equal(await waitForDeath(grandchildPid), true);
  });

  it("is idempotent", async () => {
    const { child, grandchildPid } = await spawnTree();
    const close = createShimCloser(child, GRACE_MS);
    close();
    close();
    assert.equal(await waitForDeath(grandchildPid), true);
  });

  it("killAllShimGroups ends shims that were never closed", async () => {
    const { child, grandchildPid } = await spawnTree();
    createShimCloser(child, GRACE_MS);
    killAllShimGroups();
    assert.equal(await waitForDeath(grandchildPid), true);
  });

  it("stops tracking a shim whose group exits on its own, so close() signals nothing", async () => {
    const child = spawn("sh", ["-c", "exit 0"], { stdio: "ignore", detached: true });
    const exited = once(child, "exit");
    const close = createShimCloser(child, GRACE_MS);
    await exited;
    const deadline = Date.now() + DEATH_WAIT_MS;
    while (child.pid !== undefined && isTrackedShimGroup(child.pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    assert.equal(child.pid !== undefined && isTrackedShimGroup(child.pid), false);
    close();
    assert.equal(child.pid !== undefined && isTrackedShimGroup(child.pid), false);
  });
});
