export interface GithubUser {
  login: string;
  id: number;
  avatar_url?: string;
  type?: string;
}

export interface GithubRepository {
  id: number;
  full_name: string;
  owner: GithubUser;
}

export interface GithubPullRequest {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  merged?: boolean;
  draft: boolean;
  created_at: string;
  updated_at: string;
  base: { ref: string };
  head: { sha: string };
  user: GithubUser;
  requested_reviewers?: Array<GithubUser & { name?: string }>;
}

export interface GithubPullRequestPayload {
  action: string;
  number: number;
  pull_request: GithubPullRequest;
  repository: GithubRepository;
  organization?: GithubUser;
  installation?: { id: number };
}

export interface GithubReviewPayload {
  action: string;
  review: {
    id: number;
    user: GithubUser;
    state: string;
    commit_id: string;
    submitted_at: string | null;
  };
  pull_request: GithubPullRequest;
  repository: GithubRepository;
  organization?: GithubUser;
  installation?: { id: number };
}

export interface GithubCheckRunPayload {
  action: string;
  check_run: {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    head_sha: string;
    pull_requests?: Array<{ number: number; head: { sha: string } }>;
  };
  repository: GithubRepository;
  installation?: { id: number };
}

export interface GithubCheckSuitePayload {
  action: string;
  check_suite: {
    id: number;
    status: string;
    conclusion: string | null;
    head_sha: string;
    pull_requests?: Array<{ number: number; head: { sha: string } }>;
  };
  repository: GithubRepository;
  installation?: { id: number };
}

export interface GithubWorkflowRunPayload {
  action: string;
  workflow_run: {
    id: number;
    status: string;
    conclusion: string | null;
    head_sha: string;
    pull_requests?: Array<{ number: number; head: { sha: string } }>;
  };
  repository: GithubRepository;
  installation?: { id: number };
}

export interface GithubStatusPayload {
  state: string;
  sha: string;
  branches?: Array<{ name: string }>;
  repository: GithubRepository;
  context?: string;
  installation?: { id: number };
}
