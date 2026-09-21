import { execFileSync } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkedOutRevision, resolveRevision } from "../src/revision";

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
