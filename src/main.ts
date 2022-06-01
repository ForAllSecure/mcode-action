import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import * as tc from "@actions/tool-cache";
import { readFileSync, chmodSync } from "fs";

// Return local path to donwloaded or cached CLI
async function mcodeCLI(): Promise<string> {
  // Get latest version from API
  const cliVersion = "latest";
  const os = "Linux";
  const bin = "mayhem";

  // Return cache if available
  // const cachedPath = tc.find(bin, cliVersion, os);
  // if (cachedPath) {
  //   core.debug(`found cache: ${cachedPath}`);
  //   return `${cachedPath}/${bin}`;
  // }

  // Download the CLI and cache it if version is set
  const mcodePath = await tc.downloadTool(
    `https://mayhem.forallsecure.com/cli/${os}/${bin}`
  );
  chmodSync(mcodePath, 0o755);
  // const folder = await tc.cacheFile(mcodePath, bin, bin, cliVersion, os);
  // return `${folder}/${bin}`;
  return mcodePath;
}

async function run(): Promise<void> {
  try {
    const cli = await mcodeCLI();

    // Load inputs
    const mayhemUrl: string =
      core.getInput("mayhem-url") || "https://mayhem.forallsecure.com";
    const githubToken: string = core.getInput("github-token", {
      required: true,
    });
    const mayhemToken: string = core.getInput("mayhem-token") || githubToken;
    const sarifOutput: string = core.getInput("sarif-output") || "";
    const verbosity: string = core.getInput("verbosity") || "info";
    const args: string[] = (core.getInput("args") || "").split(" ");
    // defaults next
    if (!args.includes("--duration")) {
      args.push("--duration", "60");
    }
    if (!args.includes("--image")) {
      args.push("--image", "forallsecure/debian-buster:latest");
    }

    const mayhemfile = args.includes("--file")
      ? args[args.indexOf("--file") + 1]
      : "Mayhemfile";

    // Auto-generate target name
    const repo = process.env["GITHUB_REPOSITORY"];
    const account = repo?.split("/")[0].toLowerCase();
    const project = repo?.split("/")[1].toLowerCase();
    if (repo === undefined) {
      throw Error(
        "Missing GITHUB_REPOSITORY environment variable. Are you not running this in a Github Action environment?"
      );
    }
    const event =
      JSON.parse(
        readFileSync(process.env["GITHUB_EVENT_PATH"] || "event.json", "utf-8")
      ) || {};
    const event_pull_request = event.pull_request;
    const ci_url = `${process.env["GITHUB_SERVER_URL"]}:443/${repo}/actions/runs/${process.env["GITHUB_RUN_ID"]}`;
    const branch_name = event_pull_request
      ? event_pull_request.head.ref
      : process.env["GITHUB_REF_NAME"]?.slice("refs/heads/".length) || "main";
    const revision = event_pull_request
      ? event_pull_request.head.sha
      : process.env["GITHUB_SHA"] || "unknown";
    const merge_base_branch_name = event_pull_request
      ? event_pull_request.base.ref
      : "main";

    args.push("--ci-url", ci_url);
    args.push("--merge-base-branch-name", merge_base_branch_name);
    args.push("--branch-name", branch_name);
    args.push("--revision", revision);

    const argsString = args.join(" ");
    // decide on the application type

    const script = `
    set -x
    if [ -n "${sarifOutput}" ]; then
      mkdir -p ${sarifOutput};
    fi
    sed -i "s,project:.*,project: ${repo.toLowerCase()},g" ${mayhemfile};
    run=$(${cli} --verbosity ${verbosity} run . --project ${repo.toLowerCase()} --owner ${account} ${argsString});
    if [ -z "$run" ]; then
      exit 1
    fi
    if [ -n "${sarifOutput}" ]; then
      sarifName="$(echo $run | awk -F / '{ print $(NF-1) }').sarif";
      run=$(echo $run | awk -F/ {'print $(NF-2) "/" $(NF-1) "/" $(NF)'})
      echo $run
      ${cli} --verbosity ${verbosity} wait $run --owner ${account} --sarif ${sarifOutput}/$sarifName;
      status=$(${cli} --verbosity ${verbosity} show --owner ${account} --format json $run | jq '.[0].status')
      if [[ $status == *"stopped"* || $status == *"failed"* ]]; then
        exit 2
      fi
    fi
`;
    process.env["MAYHEM_TOKEN"] = mayhemToken;
    process.env["MAYHEM_URL"] = mayhemUrl;
    process.env["MAYHEM_PROJECT"] = repo;

    // Start fuzzing
    const cliRunning = exec.exec("bash", ["-c", script], {
      ignoreReturnCode: true,
    });
    const res = await cliRunning;
    if (res == 1) {
      // TODO: should we print issues here?
      throw new Error(`The Mayhem for Code scan was unable to execute the Mayhem run for your target.
      Check your configuration. For package visibility/permissions issues, see
      https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility
      on how to set your package to 'Public'.`);
    } else if (res == 2) {
      throw new Error(
        "The Mayhem for Code scan detected the Mayhem run for your target was unsuccessful."
      );
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      core.info(`mcode action failed with: ${err.message}`);
      core.setFailed(err.message);
    }
  }
}

run();
