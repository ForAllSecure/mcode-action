import { execFileSync } from "child_process";

/** Where the revision recorded on a Mayhem run came from, for the action log. */
export type RevisionSource =
  | "revision input"
  | "pull request head"
  | "checked-out HEAD"
  | "GITHUB_SHA"
  | "unknown";

/** What git said about the workspace: the commit at HEAD, or why it could not be read. */
export type CheckedOut = { sha?: string; error?: string };

/**
 * The commit the workspace actually has checked out. Never throws: when `cwd`
 * is not inside a git checkout, git is unavailable, or the answer is not a
 * commit id, `error` says why so the caller can warn instead of silently
 * falling back to GITHUB_SHA.
 * @param cwd the directory to ask git about, normally the package path.
 * @return `{sha}` with the 40-hex commit id of HEAD, or `{error}`.
 */
export function checkedOutRevision(cwd: string): CheckedOut {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim();
    return /^[0-9a-f]{40}$/.test(out)
      ? { sha: out }
      : { error: `git rev-parse HEAD in '${cwd}' returned '${out}'` };
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const detail =
      (e.stderr ? e.stderr.toString().trim() : "") || e.message || String(err);
    return { error: `git rev-parse HEAD in '${cwd}' failed: ${detail}` };
  }
}

/**
 * Which commit to record on the Mayhem run, in order of trust:
 *   1. an explicit `revision` input;
 *   2. a pull request's head commit (a pull_request checkout is the merge
 *      commit, and Mayhem should link the run to the branch head);
 *   3. the commit the workspace has checked out;
 *   4. GITHUB_SHA.
 * GITHUB_SHA is fixed when the workflow run starts, so a job that checks out a
 * different ref would otherwise label the run with a commit it did not build:
 * a reusable workflow called with a freshly rebased commit, a workflow_run
 * handler, an explicit `ref:` on actions/checkout. Preferring the checkout
 * records what was actually fuzzed.
 * @param explicit the `revision` input, possibly empty.
 * @param pullRequestHeadSha `event.pull_request.head.sha` when the event is a pull request.
 * @param checkedOut what `checkedOutRevision` found in the package path.
 * @param envSha `process.env.GITHUB_SHA`.
 * @return the revision to pass to the CLI and where it came from.
 */
export function resolveRevision(
  explicit: string | undefined,
  pullRequestHeadSha: string | undefined,
  checkedOut: string | undefined,
  envSha: string | undefined,
): { revision: string; source: RevisionSource } {
  if (explicit) {
    return { revision: explicit, source: "revision input" };
  }
  if (pullRequestHeadSha) {
    return { revision: pullRequestHeadSha, source: "pull request head" };
  }
  if (checkedOut) {
    return { revision: checkedOut, source: "checked-out HEAD" };
  }
  if (envSha) {
    return { revision: envSha, source: "GITHUB_SHA" };
  }
  return { revision: "unknown", source: "unknown" };
}
