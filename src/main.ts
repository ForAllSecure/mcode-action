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
  const cachedPath = tc.find(bin, cliVersion, os);
  if (cachedPath) {
    core.debug(`found cache: ${cachedPath}`);
    return `${cachedPath}/${bin}`;
  }

  // Download the CLI and cache it if version is set
  const mcodePath = await tc.downloadTool(
    `https://mayhem.forallsecure.com/cli/${os}/${bin}`
  );
  chmodSync(mcodePath, 0o755);
  const folder = await tc.cacheFile(mcodePath, bin, bin, cliVersion, os);
  return `${folder}/${bin}`;
}

async function run(): Promise<void> {
  try {
    // Disable auto udpates since we always get the latest CLI
    process.env["SKIP_MAPI_AUTO_UPDATE"] = "true";
    const cli = await mcodeCLI();

    // Load inputs
    const mayhemUrl: string =
      core.getInput("mayhem-url") || "https://mayhem.forallsecure.com";
    const githubToken: string = core.getInput("github-token", {required: true});
    const mayhemToken: string = core.getInput("mayhem-token") || githubToken;
    const sarifOutput: string = core.getInput("sarif-output") || "";
    const args: string[] = (core.getInput("args") || "").split(" ");
    // defaults next
    if (!args.includes("--duration")) {
      args.push("--duration", "30");
    }
    if (!args.includes("--image")) {
      args.push("--image", "forallsecure/debian-buster:latest");
    }

    // Auto-generate target name
    const repo = process.env["GITHUB_REPOSITORY"];
    const account = repo?.split("/")[0].toLowerCase();
    const project = repo?.split("/")[1].toLowerCase();
    if (repo === undefined) {
      throw Error(
        "Missing GITHUB_REPOSITORY environment variable. Are you not running this in a Github Action environement?"
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
    echo "Looking for cargo fuzz targets..."
    is_rust=$(cargo fuzz list 2>/dev/null);
    if [ -n "$is_rust" ]; then
      echo "Cargo fuzz targets found. Proceeding."
      for fuzz_target in $is_rust; do
        cargo fuzz build $fuzz_target;
        for path in $(ls fuzz/target/*/*/$fuzz_target); do
          ${cli} package $path -o $fuzz_target;
          rm -rf $fuzz_target/root/lib;
          [[ -e fuzz/corpus/$fuzz_target ]] && cp fuzz/corpus/$fuzz_target/* $fuzz_target/corpus/;
          sed -i 's,project: .*,project: ${repo.toLowerCase()},g' $fuzz_target/Mayhemfile;
          run=$(${cli} run $fuzz_target --corpus file://$(pwd)/$fuzz_target/corpus ${argsString});
          if [ -n "${sarifOutput}" ]; then
            ${cli} wait $run -n ${account} --sarif ${sarifOutput}/$fuzz_target.sarif;
            run_number=$(echo $run | awk -F/ '{print $NF}')
            curl -H 'X-Mayhem-Token: token ${mayhemToken}' ${mayhemUrl}/api/v2/namespace/${account}/project/${project}/target/$fuzz_target/run/$run_number > $fuzz_target.json
          fi
        done
      done
    else
      echo "No cargo fuzz targets found. Proceeding."
      sed -i 's,project: .*,project: ${repo.toLowerCase()},g' Mayhemfile;
      fuzz_target=$(grep target: Mayhemfile | awk '{print $2}')
      run=$(${cli} run . ${argsString});
      if [ -n "${sarifOutput}" ]; then
        ${cli} wait $run -n ${account} --sarif ${sarifOutput}/target.sarif;
        run_number=$(echo $run | awk -F/ '{print $NF}')
        curl -H 'X-Mayhem-Token: token ${mayhemToken}' ${mayhemUrl}/api/v2/namespace/${account}/project/${project}/target/$fuzz_target/run/$run_number > mayhem.json
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
    if (res !== 0) {
      // TODO: should we print issues here?
      throw new Error("The Mayhem for Code scan found issues in the Target");
    }

    if (githubToken !== undefined) {
      const octokit = github.getOctokit(githubToken);
      const context = github.context;
      const { pull_request } = context.payload;
      const output = JSON.parse(readFileSync("mayhem.json", "utf-8")) || {};
      core.info(`pull request ready: ${pull_request !== undefined}`);
      if (pull_request !== undefined) {
        await octokit.rest.issues.createComment({
          ...context.repo,
          issue_number: pull_request.number,
          body: `# [Mayhem for Code](${mayhemUrl}) Report :warning:

Merging [#${pull_request.number}](${pull_request.html_url}) ${
            pull_request.head.ref
          } (${pull_request.head.sha.slice(0, 8)}) into ${
            pull_request.base.ref
          } (${pull_request.base.sha.slice(0, 8)})

## Active Defects: ${output.n_defects} :x:

## Testing Iterations Performed: ${output.tests_run} (${
            output.cputime
          } CPU seconds)

## Testing Inputs Stored: ${output.n_testcase_reports}

## Dynamic Block Coverage: ${
            (output.run_attributes.n_blocks_covered * 100.0) /
            output.run_attributes.n_blocks_total
          }%

[Continue to view full report in Mayhem for Code](${mayhemUrl}/${repo})

`,
        });
      }
      core.info(`token defined: ${githubToken !== undefined}`);
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      core.info(`mcode action failed with: ${err.message}`);
      core.setFailed(err.message);
    }
  }
}

run();
