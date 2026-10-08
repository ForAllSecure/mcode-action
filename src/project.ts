/**
 * The project name to hand Mayhem.
 *
 * Mayhem stores a project name with every character outside [a-z0-9-] turned
 * into "-": a repository named `My_Project` becomes the project `my-project`.
 * The `mayhem run` CLI and the project lookups accept either spelling, but a
 * Mayhemfile's server-side test suite
 * (`https://$MAYHEM_DOMAIN/$MAYHEM_PROJECT/$MAYHEM_TARGET/testsuite.tar`) is
 * access-checked against the literal name, so a `MAYHEM_PROJECT` that still
 * holds the `_` names a project the token cannot use and the run fails to start
 * ("You do not have access to use a test suite from the project my_project").
 *
 * `name` is either a bare project name or the `owner/project` form
 * (`GITHUB_REPOSITORY`, the default). Each segment is normalized on its own so
 * the separator survives. GitHub owner names are already [A-Za-z0-9-], so only
 * the case of the owner segment changes.
 */
export function mayhemProjectSlug(name: string): string {
  return name
    .toLowerCase()
    .split("/")
    .map((segment) => segment.replace(/[^a-z0-9-]/g, "-"))
    .join("/");
}
