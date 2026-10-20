import { execFileSync } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  checkedOutRevision,
  firstParent,
  resolveBuildId,
  resolveMergeBaseBranch,
  resolveParentRevision,
  resolveRevision,
  upstreamMergeBase,
} from "../src/revision";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

describe("resolveRevision", () => {
  test("an explicit revision input wins over everything", () => {
    expect(resolveRevision("deadbeef", SHA_A, SHA_B, SHA_C)).toEqual({
      revision: "deadbeef",
      source: "revision input",
    });
  });

  test("a pull request's head commit wins over the checkout and GITHUB_SHA", () => {
    expect(resolveRevision("", SHA_A, SHA_B, SHA_C)).toEqual({
      revision: SHA_A,
      source: "pull request head",
    });
  });

  test("the checked-out HEAD wins over GITHUB_SHA (a reusable workflow called with a rebased commit)", () => {
    expect(resolveRevision("", undefined, SHA_B, SHA_C)).toEqual({
      revision: SHA_B,
      source: "checked-out HEAD",
    });
  });

  test("GITHUB_SHA is the fallback when nothing is checked out", () => {
    expect(resolveRevision("", undefined, undefined, SHA_C)).toEqual({
      revision: SHA_C,
      source: "GITHUB_SHA",
    });
  });

  test("'unknown' when there is nothing at all", () => {
    expect(resolveRevision("", undefined, undefined, undefined)).toEqual({
      revision: "unknown",
      source: "unknown",
    });
  });
});

describe("checkedOutRevision", () => {
  test("reads HEAD of the checkout it is pointed at", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: join(__dirname, ".."),
    })
      .toString()
      .trim();
    expect(checkedOutRevision(join(__dirname, ".."))).toEqual({ sha: head });
  });

  test("outside a git checkout it reports git's own error instead of swallowing it", () => {
    const r = checkedOutRevision(mkdtempSync(join(tmpdir(), "no-git-")));
    expect(r.sha).toBeUndefined();
    expect(r.error).toMatch(
      /git rev-parse HEAD in .* failed: .*not a git repository/i,
    );
  });

  test("a directory that does not exist is an error too, never a throw", () => {
    const r = checkedOutRevision("/nonexistent/path");
    expect(r.sha).toBeUndefined();
    expect(r.error).toMatch(
      /^git rev-parse HEAD in '\/nonexistent\/path' failed: /,
    );
  });
});

describe("resolveParentRevision", () => {
  test("an explicit parent-revision input wins over the commit object", () => {
    expect(resolveParentRevision("deadbeef", SHA_A)).toEqual({
      parentRevision: "deadbeef",
      source: "parent-revision input",
    });
  });

  test("the recorded revision's first parent otherwise", () => {
    expect(resolveParentRevision("", SHA_A)).toEqual({
      parentRevision: SHA_A,
      source: "commit object",
    });
  });

  test("none when neither is known", () => {
    expect(resolveParentRevision("", undefined)).toEqual({
      parentRevision: "",
      source: "none",
    });
  });
});

describe("firstParent", () => {
  /** Runs git in `cwd` with a fixed identity, returning trimmed stdout. */
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "-c",
        "init.defaultBranch=main",
        ...args,
      ],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    )
      .toString()
      .trim();

  /** A fresh repository with an empty commit per message, returning its path. */
  const repoWith = (...messages: string[]): string => {
    const dir = mkdtempSync(join(tmpdir(), "parent-"));
    git(dir, "init", "-q");
    for (const m of messages)
      git(dir, "commit", "-q", "--allow-empty", "-m", m);
    return dir;
  };

  test("reads the parent of a commit with full history", () => {
    const dir = repoWith("upstream", "mayhem layer");
    expect(firstParent(dir, git(dir, "rev-parse", "HEAD"))).toEqual(
      git(dir, "rev-parse", "HEAD^"),
    );
  });

  test("reads the parent in a depth-1 clone, where HEAD^ is not available", () => {
    const src = repoWith("upstream", "mayhem layer");
    const clone = mkdtempSync(join(tmpdir(), "shallow-"));
    git(clone, "clone", "-q", "--depth", "1", `file://${src}`, ".");
    expect(() => git(clone, "rev-parse", "--verify", "HEAD^")).toThrow();
    expect(firstParent(clone, git(clone, "rev-parse", "HEAD"))).toEqual(
      git(src, "rev-parse", "HEAD^"),
    );
  });

  test("a merge commit gives its first parent", () => {
    const dir = repoWith("base");
    git(dir, "checkout", "-q", "-b", "side");
    git(dir, "commit", "-q", "--allow-empty", "-m", "side");
    git(dir, "checkout", "-q", "main");
    git(dir, "commit", "-q", "--allow-empty", "-m", "main");
    const mainHead = git(dir, "rev-parse", "HEAD");
    git(dir, "merge", "-q", "--no-ff", "-m", "merge", "side");
    expect(firstParent(dir, git(dir, "rev-parse", "HEAD"))).toEqual(mainHead);
  });

  test("a root commit has none, even when its message has a parent line", () => {
    const dir = repoWith(`root\n\nparent ${SHA_A}`);
    expect(firstParent(dir, git(dir, "rev-parse", "HEAD"))).toBeUndefined();
  });

  test("a commit that is not present, or no git at all, is undefined, never a throw", () => {
    expect(firstParent(repoWith("x"), SHA_B)).toBeUndefined();
    expect(
      firstParent(mkdtempSync(join(tmpdir(), "no-git-")), SHA_B),
    ).toBeUndefined();
    expect(firstParent("/nonexistent/path", SHA_B)).toBeUndefined();
  });
});

describe("upstreamMergeBase", () => {
  /** A fake GitHub client answering each route with `answers[route]`. */
  const api = (answers: Record<string, unknown>) => ({
    calls: [] as Record<string, string>[],
    async request(route: string, params: Record<string, string>) {
      this.calls.push({ route, ...params });
      const answer = answers[route];
      if (answer instanceof Error) throw answer;
      return { data: answer };
    },
  });
  const COMPARE = "GET /repos/{owner}/{repo}/compare/{basehead}";

  test("a fork gives the merge base with the upstream default branch", async () => {
    const gh = api({
      "GET /repos/{owner}/{repo}": {
        parent: { full_name: "tj/histo", default_branch: "master" },
      },
      [COMPARE]: { merge_base_commit: { sha: SHA_B } },
    });
    expect(await upstreamMergeBase(gh, "mayhemheroes/histo", SHA_A)).toEqual({
      sha: SHA_B,
    });
    expect(gh.calls[1]).toEqual({
      route: COMPARE,
      owner: "mayhemheroes",
      repo: "histo",
      basehead: `tj:histo:master...${SHA_A}`,
    });
  });

  test("a repository that is not a fork has none", async () => {
    const gh = api({ "GET /repos/{owner}/{repo}": {} });
    expect(await upstreamMergeBase(gh, "o/r", SHA_A)).toEqual({});
  });

  test("an API failure is an error, never a throw", async () => {
    const gh = api({
      "GET /repos/{owner}/{repo}": {
        parent: { full_name: "u/r", default_branch: "main" },
      },
      [COMPARE]: new Error("Not Found"),
    });
    expect(await upstreamMergeBase(gh, "o/r", SHA_A)).toEqual({
      error: "Not Found",
    });
  });
});

describe("resolveBuildId", () => {
  test("an explicit build-id input wins over the merge base", () => {
    expect(resolveBuildId("b42", SHA_A)).toEqual({
      buildId: "b42",
      source: "build-id input",
    });
  });

  test("the upstream merge base otherwise", () => {
    expect(resolveBuildId("", SHA_A)).toEqual({
      buildId: SHA_A,
      source: "upstream merge base",
    });
  });

  test("none when neither is known", () => {
    expect(resolveBuildId("", undefined)).toEqual({
      buildId: "",
      source: "none",
    });
  });
});

describe("resolveMergeBaseBranch", () => {
  test("a pull request's base branch", () => {
    const pr = { head: { ref: "topic", sha: SHA_A }, base: { ref: "dev" } };
    expect(
      resolveMergeBaseBranch({
        pull_request: pr,
        repository: { default_branch: "trunk" },
      }),
    ).toEqual("dev");
  });

  test("the repository's default branch outside a pull request", () => {
    expect(
      resolveMergeBaseBranch({ repository: { default_branch: "trunk" } }),
    ).toEqual("trunk");
  });

  test("main when the payload names no repository", () => {
    expect(resolveMergeBaseBranch({})).toEqual("main");
  });
});
