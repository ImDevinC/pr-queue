import { createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";
import type { GithubPullRequest } from "./types.js";

export interface GithubInstallation {
  id: number;
  account: { id: number; login: string };
}

export interface GithubReview {
  id: number;
  user: { id: number; login: string };
  state: string;
  commit_id: string;
  submitted_at: string | null;
}

export interface GithubCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
}

export interface GithubCommitStatus {
  id: number;
  state: string;
  context: string;
}

export interface GithubWorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
}

export interface GithubApi {
  getBranchRules(
    repository: string,
    branch: string,
    installationId: number,
  ): Promise<unknown>;
  getInstallationRepositories(
    installationId: number,
  ): Promise<Array<{ id: number; full_name: string }>>;
  getPullRequest(
    repository: string,
    number: number,
    installationId: number,
  ): Promise<GithubPullRequest>;
  getRepository(
    repository: string,
    installationId: number,
  ): Promise<{ id: number; full_name: string; owner: { id: number; login: string } }>;
  getInstallations(): Promise<GithubInstallation[]>;
  getPullRequestReviews(
    repository: string,
    number: number,
    installationId: number,
  ): Promise<GithubReview[]>;
  getCheckRuns(
    repository: string,
    ref: string,
    installationId: number,
  ): Promise<GithubCheckRun[]>;
  getCommitStatuses(
    repository: string,
    ref: string,
    installationId: number,
  ): Promise<GithubCommitStatus[]>;
  getWorkflowRuns(
    repository: string,
    headSha: string,
    installationId: number,
  ): Promise<GithubWorkflowRun[]>;
}

export function createGithubApi(options: {
  appId: number;
  privateKey: string;
  apiUrl: string;
}): GithubApi {
  const tokens = new Map<number, { value: string; expiresAt: number }>();

  async function appJwt(): Promise<string> {
    const key = createPrivateKey(options.privateKey.replace(/\\n/g, "\n"));
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(String(options.appId))
      .setIssuedAt()
      .setExpirationTime("9m")
      .sign(key);
  }

  async function installationToken(installationId: number): Promise<string> {
    const existing = tokens.get(installationId);
    if (existing && existing.expiresAt > Date.now() + 60_000)
      return existing.value;
    const response = await fetch(
      `${options.apiUrl}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await appJwt()}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!response.ok)
      throw new Error(`GitHub installation token failed: ${response.status}`);
    const body = (await response.json()) as {
      token: string;
      expires_at: string;
    };
    const next = { value: body.token, expiresAt: Date.parse(body.expires_at) };
    tokens.set(installationId, next);
    return next.value;
  }

  async function request(
    path: string,
    installationId: number,
  ): Promise<unknown> {
    const response = await fetch(`${options.apiUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${await installationToken(installationId)}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok)
      throw new Error(`GitHub API request failed: ${response.status}`);
    return response.json();
  }

  return {
    async getBranchRules(repository, branch, installationId) {
      return request(
        `/repos/${repository}/rules/branches/${encodeURIComponent(branch)}`,
        installationId,
      );
    },
    async getInstallationRepositories(installationId) {
      const result = (await request(
        `/installation/repositories?per_page=100`,
        installationId,
      )) as {
        repositories: Array<{ id: number; full_name: string }>;
      };
      return result.repositories;
    },
    async getPullRequest(repository, number, installationId) {
      return request(
        `/repos/${repository}/pulls/${number}`,
        installationId,
      ) as Promise<GithubPullRequest>;
    },
    async getRepository(repository, installationId) {
      return request(
        `/repos/${repository}`,
        installationId,
      ) as Promise<{
        id: number;
        full_name: string;
        owner: { id: number; login: string };
      }>;
    },
    async getInstallations() {
      const response = await fetch(
        `${options.apiUrl}/app/installations?per_page=100`,
        {
          headers: {
            Authorization: `Bearer ${await appJwt()}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (!response.ok)
        throw new Error(
          `GitHub installations request failed: ${response.status}`,
        );
      return response.json() as Promise<GithubInstallation[]>;
    },
    async getPullRequestReviews(repository, number, installationId) {
      const result = (await request(
        `/repos/${repository}/pulls/${number}/reviews`,
        installationId,
      )) as GithubReview[];
      return result;
    },
    async getCheckRuns(repository, ref, installationId) {
      const result = (await request(
        `/repos/${repository}/commits/${ref}/check-runs?per_page=100`,
        installationId,
      )) as {
        check_runs: GithubCheckRun[];
      };
      return result.check_runs ?? [];
    },
    async getCommitStatuses(repository, ref, installationId) {
      const result = (await request(
        `/repos/${repository}/commits/${ref}/status`,
        installationId,
      )) as {
        statuses: GithubCommitStatus[];
      };
      return result.statuses ?? [];
    },
    async getWorkflowRuns(repository, headSha, installationId) {
      const result = (await request(
        `/repos/${repository}/actions/runs?head_sha=${headSha}&per_page=100`,
        installationId,
      )) as {
        workflow_runs: GithubWorkflowRun[];
      };
      return result.workflow_runs ?? [];
    },
  };
}
