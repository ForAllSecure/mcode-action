import { mayhemProjectSlug } from "../src/project";

describe("mayhemProjectSlug", () => {
  test("a name that is already a Mayhem slug is unchanged", () => {
    expect(mayhemProjectSlug("mcode-action")).toBe("mcode-action");
    expect(mayhemProjectSlug("forallsecure/mcode-action")).toBe(
      "forallsecure/mcode-action",
    );
  });

  test("it lowercases, as before", () => {
    expect(mayhemProjectSlug("ForAllSecure/Mcode-Action")).toBe(
      "forallsecure/mcode-action",
    );
  });

  test("an underscore becomes a dash (the case that failed run creation)", () => {
    // GITHUB_REPOSITORY for owner/My_Project; Mayhem stores it as my-project.
    expect(mayhemProjectSlug("Owner/My_Project")).toBe("owner/my-project");
    expect(mayhemProjectSlug("some_lib")).toBe("some-lib");
  });

  test("a dot becomes a dash", () => {
    expect(mayhemProjectSlug("owner/parser.rs")).toBe("owner/parser-rs");
    expect(mayhemProjectSlug("some.lib")).toBe("some-lib");
  });

  test("every other character outside [a-z0-9-] becomes a dash, one for one", () => {
    expect(mayhemProjectSlug("a__b.c+d")).toBe("a--b-c-d");
  });

  test("the owner/project separator is kept", () => {
    expect(mayhemProjectSlug("owner/some.lib_legacy")).toBe(
      "owner/some-lib-legacy",
    );
  });
});
