"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const github = __importStar(require("@actions/github"));
const tc = __importStar(require("@actions/tool-cache"));
const fs_1 = require("fs");
// Return local path to donwloaded or cached CLI
function mcodeCLI() {
    return __awaiter(this, void 0, void 0, function* () {
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
        const mcodePath = yield tc.downloadTool(`https://mayhem.forallsecure.com/cli/${os}/${bin}`);
        (0, fs_1.chmodSync)(mcodePath, 0o755);
        const folder = yield tc.cacheFile(mcodePath, bin, bin, cliVersion, os);
        return `${folder}/${bin}`;
    });
}
function run() {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Disable auto udpates since we always get the latest CLI
            process.env["SKIP_MAPI_AUTO_UPDATE"] = "true";
            const cli = yield mcodeCLI();
            // Load inputs
            const mayhemUrl = core.getInput("mayhem-url") || "https://mayhem.forallsecure.com";
            const githubToken = core.getInput("github-token");
            const mayhemToken = core.getInput("mayhem-token", {
                required: true,
            });
            const sarifOutput = core.getInput("sarif-output") || "";
            const args = (core.getInput("args") || "").split(" ");
            // defaults next
            if (!args.includes("--duration")) {
                args.push("--duration", "30");
            }
            if (!args.includes("--image")) {
                args.push("--image", "forallsecure/debian-buster:latest");
            }
            // Auto-generate target name
            const repo = process.env["GITHUB_REPOSITORY"];
            const account = repo === null || repo === void 0 ? void 0 : repo.split("/")[0].toLowerCase();
            const project = repo === null || repo === void 0 ? void 0 : repo.split("/")[1].toLowerCase();
            if (repo === undefined) {
                throw Error("Missing GITHUB_REPOSITORY environment variable. Are you not running this in a Github Action environement?");
            }
            const event = JSON.parse((0, fs_1.readFileSync)(process.env["GITHUB_EVENT_PATH"] || "event.json", "utf-8")) || {};
            const event_pull_request = event.pull_request;
            const ci_url = `${process.env["GITHUB_SERVER_URL"]}:443/${repo}/actions/runs/${process.env["GITHUB_RUN_ID"]}`;
            const branch_name = event_pull_request
                ? event_pull_request.head.ref
                : ((_a = process.env["GITHUB_REF_NAME"]) === null || _a === void 0 ? void 0 : _a.slice("refs/heads/".length)) || "main";
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
      if [ -n "run" ]; then
        exit 1
      fi
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
            const res = yield cliRunning;
            if (res !== 0) {
                // TODO: should we print issues here?
                throw new Error("The Mayhem for Code scan found issues in the Target");
            }
            if (githubToken !== undefined) {
                const octokit = github.getOctokit(githubToken);
                const context = github.context;
                const { pull_request } = context.payload;
                const output = JSON.parse((0, fs_1.readFileSync)("mayhem.json", "utf-8")) || {};
                core.info(`pull request ready: ${pull_request !== undefined}`);
                if (pull_request !== undefined) {
                    yield octokit.rest.issues.createComment(Object.assign(Object.assign({}, context.repo), { issue_number: pull_request.number, body: `# [Mayhem for Code](${mayhemUrl}) Report :warning:

Merging [#${pull_request.number}](${pull_request.html_url}) ${pull_request.head.ref} (${pull_request.head.sha.slice(0, 8)}) into ${pull_request.base.ref} (${pull_request.base.sha.slice(0, 8)})

## Active Defects: ${output.n_defects} :x:

## Testing Iterations Performed: ${output.tests_run} (${output.cputime} CPU seconds)

## Testing Inputs Stored: ${output.n_testcase_reports}

## Dynamic Block Coverage: ${(output.run_attributes.n_blocks_covered * 100.0) /
                            output.run_attributes.n_blocks_total}%

[Continue to view full report in Mayhem for Code](${mayhemUrl}/${repo})

` }));
                }
                core.info(`token defined: ${githubToken !== undefined}`);
            }
        }
        catch (err) {
            if (err instanceof Error) {
                core.info(`mcode action failed with: ${err.message}`);
                core.setFailed(err.message);
            }
        }
    });
}
run();
