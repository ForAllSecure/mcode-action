import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { readFileSync, chmodSync } from "fs";

const mayhemUrl: string =
  core.getInput("mayhem-url") || "https://app.mayhem.security";

/** Return local path to donwloaded or cached CLI */
async function mcodeCLI(): Promise<string> {
  // Get latest version from API
  const os = "Linux";
  const bin = "mayhem";

  // Download the CLI and cache it if version is set
  const mcodePath = await tc.downloadTool(`${mayhemUrl}/cli/${os}/${bin}`);
  chmodSync(mcodePath, 0o755);
  // const folder = await tc.cacheFile(mcodePath, bin, bin, cliVersion, os);
  // return `${folder}/${bin}`;
  return mcodePath;
}

/** Mapping action arguments to CLI arguments and completing a run */
async function run(): Promise<void> {
  try {
    const cli = await mcodeCLI();

    // Load inputs
    const githubToken: string = core.getInput("github-token", {
      required: true,
    });
    const mayhemToken: string = core.getInput("mayhem-token") || githubToken;
    const packagePath: string = core.getInput("package") || ".";
    const sarifOutput: string = core.getInput("sarif-output") || "";
    const junitOutput: string = core.getInput("junit-output") || "";
    const coverageOutput: string = core.getInput("coverage-output") || "";
    const failOnDefects: boolean =
      core.getBooleanInput("fail-on-defects") || false;
    const verbosity: string = core.getInput("verbosity") || "info";
    const owner: string = core.getInput("owner").toLowerCase();
    const args: string[] = (core.getInput("args") || "").split(" ");

    // defaults next
    if (!args.includes("--duration")) {
      args.push("--duration", "60");
    }
    if (!args.includes("--image")) {
      args.push("--image", "forallsecure/debian-buster:latest");
    }

    const repo = process.env["GITHUB_REPOSITORY"];
    if (repo === undefined) {
      throw Error(
        "Missing GITHUB_REPOSITORY environment variable. " +
          "Are you not running this in a Github Action environment?",
      );
    }

    const project: string = (core.getInput("project") || repo).toLowerCase();
    const eventPath = process.env["GITHUB_EVENT_PATH"] || "event.json";
    const event = JSON.parse(readFileSync(eventPath, "utf-8")) || {};
    const eventPullRequest = event.pull_request;
    const ghRepo = `${process.env["GITHUB_SERVER_URL"]}:443/${repo}/`;
    const ciUrl = `${ghRepo}/actions/runs/${process.env["GITHUB_RUN_ID"]}`;
    const branchName = eventPullRequest
      ? eventPullRequest.head.ref
      : process.env["GITHUB_REF_NAME"]?.slice("refs/heads/".length) || "main";
    const revision = eventPullRequest
      ? eventPullRequest.head.sha
      : process.env["GITHUB_SHA"] || "unknown";
    const mergeBaseBranchName = eventPullRequest
      ? eventPullRequest.base.ref
      : "main";

    args.push("--ci-url", ciUrl);
    args.push("--merge-base-branch-name", mergeBaseBranchName);
    args.push("--branch-name", branchName);
    args.push("--revision", revision);

    const argsString = args.join(" ");

    // Generate arguments for wait command
    // sarif, junit, coverage

    const waitArgs = [];
    if (sarifOutput) {
      // $runName is a variable that is set in the bash script
      waitArgs.push("--sarif", `${sarifOutput}/\${runName}.sarif`);
    }
    if (junitOutput) {
      // $runName is a variable that is set in the bash script
      waitArgs.push("--junit", `${junitOutput}/\${runName}.xml`);
    }
    if (coverageOutput) {
      waitArgs.push("--coverage");
    }
    if (failOnDefects) {
      waitArgs.push("--fail-on-defects");
    }

    // create wait args string
    const waitArgsString = waitArgs.join(" ");

    const script = `
    set -xe
    # create sarif output directory
    if [ -n "${sarifOutput}" ]; then
      mkdir -p ${sarifOutput};
    fi

    # create junit output directory
    if [ -n "${junitOutput}" ]; then
      mkdir -p ${junitOutput};
    fi

    # create coverage output directory
    if [ -n "${coverageOutput}" ]; then
      mkdir -p ${coverageOutput};
    fi

    # Run mayhem
    run=$(${cli} --verbosity ${verbosity} run ${packagePath} \
                 --project ${project} \
                 --owner ${owner} ${argsString});

    # Persist the run id to the GitHub output
    echo "runId=$run" >> $GITHUB_OUTPUT;

    if [ -n "$run" ]; then
      echo "Run $run succesfully scheduled.";
    else
      echo "Could not start run successfully, exiting with non-zero exit code.".
      exit 1;
    fi

    # if the user didn't specify requiring any output, don't wait for the result.
    if [ -z "${coverageOutput}" ] && \
        [ -z "${junitOutput}" ] && \
        [ -z "${sarifOutput}" ] && \
        [ "${failOnDefects.toString().toLowerCase()}" != "true" ]; then
      echo "No coverage, junit or sarif output requested, not waiting for job result.";
      exit 0;
    fi

    # run name is the last part of the run id
    runName="$(echo $run | awk -F / '{ print $(NF-1) }')";

    # wait for run to finish
    if ! ${cli} --verbosity ${verbosity} wait $run \
            --owner ${owner} \
            ${waitArgsString}; then
      exit 3;
    fi
    
    
    # check status, exit with non-zero status if failed or stopped
    status=$(${cli} --verbosity ${verbosity} show \
                    --owner ${owner} \
                    --format json $run | jq '.[0].status');
    if [[ $status == *"stopped"* || $status == *"failed"* ]]; then
      exit 2;
    fi

    target=$(echo $run | cut -d'/' -f2)

    if [ -n "${coverageOutput}" ]; then
      ${cli} --verbosity ${verbosity} download --owner ${owner} $target -o ${coverageOutput};
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
      /* eslint-disable max-len */
      throw new Error(`The Mayhem for Code scan was unable to execute the Mayhem run for your target.
      Check your configuration. For package visibility/permissions issues, see
      https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility
      on how to set your package to 'Public'.`);
    } else if (res == 2) {
      throw new Error(
        "The Mayhem for Code scan detected the Mayhem run for your " +
          "target was unsuccessful.",
      );
    } else if (res == 3) {
      throw new Error("The Mayhem for Code scan found defects in your target.");
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      core.info(`mcode action failed with: ${err.message}`);
      core.setFailed(err.message);
    }
  }
}

run();
