import { getInput, getBooleanInput, info, setFailed } from "@actions/core";
import { exec } from "@actions/exec";
import { downloadTool } from "@actions/tool-cache";
import { readFileSync, chmodSync } from "fs";

const mayhemUrl: string =
  getInput("mayhem-url") || "https://app.mayhem.security";

/**
 * Operating systems that an mCode CLI is available for, mapped to the URL path it can be
 * downloaded from on a recent Mayhem cluster.
 */
enum CliOsPath {
  Linux = "Linux/mayhem",
  MacOS = "Darwin/mayhem.pkg",
  Windows = "Windows/mayhem.exe",
}

/**
 * Downloads the mCode CLI from the given Mayhem cluster, marks it as executable, and returns the
 * path to the downloaded CLI.
 * @param url the base URL of the Mayhem cluster, such as "https://app.mayhem.security".
 * @param os the operating system to download the CLI for.
 * @return Path to the downloaded mCode CLI; resolves when the CLI download is complete.
 */
async function downloadCli(url: string, os: CliOsPath): Promise<string> {
  // Download the CLI and mark it as executable.
  const mcodePath = await downloadTool(`${url}/cli/${os}`);
  chmodSync(mcodePath, 0o755);
  return mcodePath;
}

/** Mapping action arguments to CLI arguments and completing a run */
async function run(): Promise<void> {
  try {
    const cli = await downloadCli(mayhemUrl, CliOsPath.Linux);

    // Load inputs
    const githubToken: string = getInput("github-token", {
      required: true,
    });
    const mayhemToken: string = getInput("mayhem-token") || githubToken;
    const packagePath: string = getInput("package") || ".";
    const sarifOutput: string = getInput("sarif-output") || "";
    const junitOutput: string = getInput("junit-output") || "";
    const coverageOutput: string = getInput("coverage-output") || "";
    const failOnDefects: boolean = getBooleanInput("fail-on-defects") || false;
    const verbosity: string = getInput("verbosity") || "info";
    const owner: string = getInput("owner").toLowerCase();
    const args: string[] = (getInput("args") || "").split(" ");

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

    const project: string = (getInput("project") || repo).toLowerCase();
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

    # Strip the run number from the full run path to get the project/target.
    target=$(echo $run | sed 's:/[^/]*$::')

    if [ -n "${coverageOutput}" ]; then
      ${cli} --verbosity ${verbosity} download --owner ${owner} $target -o ${coverageOutput};
    fi
    `;

    process.env["MAYHEM_TOKEN"] = mayhemToken;
    process.env["MAYHEM_URL"] = mayhemUrl;
    process.env["MAYHEM_PROJECT"] = repo;

    // Start fuzzing
    const cliRunning = exec("bash", ["-c", script], {
      ignoreReturnCode: true,
    });
    const res = await cliRunning;
    if (res === 1) {
      throw new Error(`The Mayhem for Code scan was unable to execute the Mayhem run for your target.
      Check your configuration. For package visibility/permissions issues, see
      https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility
      on how to set your package to 'Public'.`);
    } else if (res === 2) {
      throw new Error(
        "The Mayhem for Code scan detected the Mayhem run for your " +
          "target was unsuccessful.",
      );
    } else if (res === 3) {
      throw new Error("The Mayhem for Code scan found defects in your target.");
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      info(`mcode action failed with: ${err.message}`);
      setFailed(err.message);
    }
  }
}

run();
