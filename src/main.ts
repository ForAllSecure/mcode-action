import { getInput, getBooleanInput, info, setFailed } from "@actions/core";
import { exec } from "@actions/exec";
import { context as githubContext } from "@actions/github";
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

type Config = {
  githubToken: string;
  mayhemToken: string;

  packagePath: string;
  sarifOutputDir: string;
  junitOutputDir: string;
  coverageOutputDir: string;

  failOnDefects: boolean;
  verbosity: string;
  owner: string;
  project: string;
  repo: string;
  ciUrl: string;
  branchName: string;
  revision: string;
  mergeBaseBranchName: string;
};

function getConfig(): Config {
  const githubToken: string = getInput("github-token", {
    required: true,
  });
  process.env["GITHUB_TOKEN"] = githubToken;

  const issueNumber = githubContext.issue.number;
  if (issueNumber) {
    process.env["GITHUB_ISSUE_ID"] = String(issueNumber);
  }

  const repo = process.env["GITHUB_REPOSITORY"];
  if (repo === undefined) {
    throw Error(
      "Missing GITHUB_REPOSITORY environment variable. " +
        "Are you not running this in a Github Action environment?",
    );
  }

  const ghRepo = `${process.env["GITHUB_SERVER_URL"]}:443/${repo}/`;
  const eventPath = process.env["GITHUB_EVENT_PATH"] || "event.json";
  const event = JSON.parse(readFileSync(eventPath, "utf-8")) || {};
  const eventPullRequest = event.pull_request;

  return {
    githubToken,
    mayhemToken: getInput("mayhem-token") || githubToken,
    packagePath: getInput("package") || ".",
    sarifOutputDir: getInput("sarif-output") || "",
    junitOutputDir: getInput("junit-output") || "",
    coverageOutputDir: getInput("coverage-output") || "",
    failOnDefects: getBooleanInput("fail-on-defects") || false,
    verbosity: getInput("verbosity") || "info",
    owner: getInput("owner").toLowerCase(),
    project: (getInput("project") || repo).toLowerCase(),
    repo,
    ciUrl: `${ghRepo}/actions/runs/${process.env["GITHUB_RUN_ID"]}`,
    branchName: eventPullRequest
      ? eventPullRequest.head.ref
      : process.env["GITHUB_REF_NAME"]?.slice("refs/heads/".length) || "main",
    revision: eventPullRequest
      ? eventPullRequest.head.sha
      : process.env["GITHUB_SHA"] || "unknown",
    mergeBaseBranchName: eventPullRequest ? eventPullRequest.base.ref : "main",
  };
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
    // Validate the action inputs and create a Config object from them.
    const config = getConfig();

    // Download the mCode CLI for Linux.
    const cli = await downloadCli(mayhemUrl, CliOsPath.Linux);

    const args: string[] = (getInput("args") || "").split(" ");

    // defaults next
    args.push("--duration", "7200");

    if (!args.includes("--image")) {
      args.push("--image", "forallsecure/debian-buster:latest");
    }

    args.push("--ci-url", config.ciUrl);
    args.push("--merge-base-branch-name", config.mergeBaseBranchName);
    args.push("--branch-name", config.branchName);
    args.push("--revision", config.revision);

    const argsString = args.join(" ");   

    const script = `
    set -xe
    # create sarif output directory
    if [ -n "${config.sarifOutputDir}" ]; then
      mkdir -p ${config.sarifOutputDir};
    fi

    # create junit output directory
    if [ -n "${config.junitOutputDir}" ]; then
      mkdir -p ${config.junitOutputDir};
    fi

    # create coverage output directory
    if [ -n "${config.coverageOutputDir}" ]; then
      mkdir -p ${config.coverageOutputDir};
    fi

    # Run mayhem
    run=$(${cli} --verbosity ${config.verbosity} run ${config.packagePath} \
                 --project ${config.project} \
                 --owner ${config.owner} ${argsString});

    # Persist the run id to the GitHub output
    echo "runId=$run" >> $GITHUB_OUTPUT;

    if [ -n "$run" ]; then
      echo "Run $run succesfully scheduled.";
    else
      echo "Could not start run successfully, exiting with non-zero exit code.".
      exit 1;
    fi    
    `;

    process.env["MAYHEM_TOKEN"] = config.mayhemToken;
    process.env["MAYHEM_URL"] = mayhemUrl;
    process.env["MAYHEM_PROJECT"] = config.repo;

    // Start fuzzing
    const attempts = 10;
    let retry = 0;
    const delay = 60000;
    const factor = 2;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const cliRunning = exec("bash", ["-c", script], {
        ignoreReturnCode: true,
      });
      const res = await cliRunning;
      if (res === 0) {
        break;
      } else if(res === 1) {
        if (retry >= attempts){
          throw new Error(`The Mayhem for Code scan was unable to execute the Mayhem run for your target.
            Check your configuration. For package visibility/permissions issues, see
            https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility
            on how to set your package to 'Public'.`);
        }else {
          retry++;
          setTimeout(() => {}, delay * factor ** retry + Math.random() * 1000);
        }
      } else if(res === 2) {
        throw new Error("The Mayhem for Code scan detected the Mayhem run for your " +
          "target was unsuccessful.");
      } else if(res === 3) {
        throw new Error("The Mayhem for Code scan found defects in your target.");
      } 
      break;
    }    
  } catch (err: unknown) {
    if (err instanceof Error) {
      info(`mcode action failed with: ${err.message}`);
      setFailed(err.message);
    }
  }
}

run();
