import { execFileSync } from "child_process";
import { GitHubEvent } from "./github";

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

/** Where the parent commit recorded on a Mayhem run came from, for the action log. */
export type ParentRevisionSource =
  | "parent-revision input"
  | "commit object"
  | "none";

/**
 * The first parent of `revision`, read from the commit object itself. Works in
 * a depth-1 checkout (actions/checkout's default), where `git rev-parse
 * <revision>^` fails: the parent object was not fetched, but the commit still
 * names it. Never throws.
 * @param cwd the directory to ask git about, normally the package path.
 * @param revision the commit whose parent to read.
 * @return the commit id of the first parent, or undefined for a root commit,
 *   a commit that is not present locally, or no git.
 */
export function firstParent(cwd: string, revision: string): string | undefined {
  try {
    const out = execFileSync("git", ["cat-file", "commit", revision], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    // The headers end at the first blank line; a "parent ..." line in the
    // commit message must not match.
    const headers = out.split("\n\n", 1)[0];
    const m = /^parent ([0-9a-f]{40,64})$/m.exec(headers);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which parent commit to record on the Mayhem run: an explicit
 * `parent-revision` input, else the first parent of the recorded revision.
 * @param explicit the `parent-revision` input, possibly empty.
 * @param fromCommit what `firstParent` found for the recorded revision.
 * @return the parent to pass to the CLI ("" for none) and where it came from.
 */
export function resolveParentRevision(
  explicit: string | undefined,
  fromCommit: string | undefined,
): { parentRevision: string; source: ParentRevisionSource } {
  if (explicit) {
    return { parentRevision: explicit, source: "parent-revision input" };
  }
  if (fromCommit) {
    return { parentRevision: fromCommit, source: "commit object" };
  }
  return { parentRevision: "", source: "none" };
}

/** Where the build id recorded on a Mayhem run came from, for the action log. */
export type BuildIdSource = "build-id input" | "upstream merge base" | "none";

/** The subset of an Octokit client that `upstreamMergeBase` uses. */
type GitHubApi = {
  request: (
    route: string,
    params: Record<string, string>,
  ) => Promise<{ data: unknown }>;
};

/**
 * The newest commit that `revision` shares with the upstream repository this
 * repository was forked from: the merge base with the upstream's default
 * branch, asked of the GitHub compare API so no upstream history needs to be
 * fetched. Never throws.
 * @param api an authenticated GitHub client.
 * @param repo this repository as "owner/name".
 * @param revision the commit recorded on the run.
 * @return `{sha}` with the merge base, `{}` when the repository is not a fork,
 *   or `{error}` when GitHub could not answer.
 */
export async function upstreamMergeBase(
  api: GitHubApi,
  repo: string,
  revision: string,
): Promise<{ sha?: string; error?: string }> {
  const [owner, name] = repo.split("/");
  try {
    const { data } = await api.request("GET /repos/{owner}/{repo}", {
      owner,
      repo: name,
    });
    const parent = (
      data as {
        parent?: { full_name: string; default_branch: string };
      }
    ).parent;
    if (!parent) {
      return {};
    }
    const [parentOwner, parentName] = parent.full_name.split("/");
    const { data: compare } = await api.request(
      "GET /repos/{owner}/{repo}/compare/{basehead}",
      {
        owner,
        repo: name,
        basehead: `${parentOwner}:${parentName}:${parent.default_branch}...${revision}`,
      },
    );
    const sha = (compare as { merge_base_commit?: { sha?: string } })
      .merge_base_commit?.sha;
    return sha
      ? { sha }
      : { error: `no merge base between ${revision} and ${parent.full_name}` };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Which build id to record on the Mayhem run: an explicit `build-id` input,
 * else the upstream merge base of the recorded revision.
 * @param explicit the `build-id` input, possibly empty.
 * @param mergeBase what `upstreamMergeBase` found.
 * @return the build id to pass to the CLI ("" for none) and where it came from.
 */
export function resolveBuildId(
  explicit: string | undefined,
  mergeBase: string | undefined,
): { buildId: string; source: BuildIdSource } {
  if (explicit) {
    return { buildId: explicit, source: "build-id input" };
  }
  if (mergeBase) {
    return { buildId: mergeBase, source: "upstream merge base" };
  }
  return { buildId: "", source: "none" };
}

/**
 * The branch a run is compared against: a pull request's base, else the
 * repository's default branch (in every event payload that names the
 * repository), else "main".
 */
export function resolveMergeBaseBranch(event: GitHubEvent): string {
  return (
    event.pull_request?.base.ref || event.repository?.default_branch || "main"
  );
}
