/**
 * The parts of the event payload (`GITHUB_EVENT_PATH`) the action reads. Each
 * object is required when present by GitHub's webhook payload schemas, but
 * absent on events that lack it (`pull_request` outside pull requests;
 * `repository` is not guaranteed on `schedule`).
 */
export interface GitHubEvent {
  pull_request?: {
    head: { ref: string; sha: string };
    base: { ref: string };
  };
  repository?: {
    default_branch: string;
  };
}
