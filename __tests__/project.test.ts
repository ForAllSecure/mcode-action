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
    // GITHUB_REPOSITORY for savantenvs/SDL_sound; Mayhem stores it as sdl-sound.
    expect(mayhemProjectSlug("SavantEnvs/SDL_sound")).toBe(
      "savantenvs/sdl-sound",
    );
    expect(mayhemProjectSlug("deno_lint")).toBe("deno-lint");
  });

  test("a dot becomes a dash", () => {
    expect(mayhemProjectSlug("savantenvs/gjson.rs")).toBe(
      "savantenvs/gjson-rs",
    );
    expect(mayhemProjectSlug("metapensiero.pj")).toBe("metapensiero-pj");
  });

  test("every other character outside [a-z0-9-] becomes a dash, one for one", () => {
    expect(mayhemProjectSlug("a__b.c+d")).toBe("a--b-c-d");
  });

  test("the owner/project separator is kept", () => {
    expect(mayhemProjectSlug("owner/dissect.cstruct_legacy")).toBe(
      "owner/dissect-cstruct-legacy",
    );
  });
});
