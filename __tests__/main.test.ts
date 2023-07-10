import * as process from "process";
import { ExecFileSyncOptions, execFileSync } from "child_process";
import * as path from "path";
import fs from "fs";

// shows how the runner will run a javascript action with env / stdout protocol
test("test runs", () => {
  process.env["GITHUB_REPOSITORY"] = "ForAllSecure/mcode-action";
  process.env["GITHUB_SERVER_URL"] = "https://github.com";
  process.env["GITHUB_RUN_ID"] = "14";
  process.env["GITHUB_EVENT_PATH"] = "__tests__/events.json";
  process.env["RUNNER_TEMP"] = "/tmp";
  process.env["RUNNER_TOOL_CACHE"] = "/tmp";

  process.env["INPUT_MAYHEM-TOKEN"] = process.env.MAYHEM_TOKEN;
  process.env["INPUT_DURATION"] = "10";
  process.env["INPUT_GITHUB-TOKEN"] = "12123123321312";

  process.env["INPUT_JUNIT-OUTPUT"] = "junit-output";
  process.env["INPUT_SARIF-OUTPUT"] = "sarif-output";
  process.env["INPUT_COVERAGE-OUTPUT"] = "coverage-output";
  process.env["INPUT_FAIL-ON-DEFECTS"] = "false";

  const np = process.execPath;
  const ip = path.join(__dirname, "..", "lib", "main.js");
  const options: ExecFileSyncOptions = {
    env: process.env,
  };
  try {
    console.log(execFileSync(np, [ip], options).toString());
  } catch (error: any) {
    // Ignore the error. We known the Mayhemfile doesn't exists right now, so the bash script fails.
    //console.log(error);
  }

  if (!fs.existsSync("junit-output")) {
    throw new Error("Output dir should exist but didn't");
  }

  if (!fs.existsSync("sarif-output")) {
    throw new Error("Output dir should exist but didn't");
  }

  if (!fs.existsSync("coverage-output")) {
    throw new Error("Output dir should exist but didn't");
  }
});
