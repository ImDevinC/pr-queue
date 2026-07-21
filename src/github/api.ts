import { importPKCS8, SignJWT } from "jose";

export interface GithubApi {
  getBranchRules(
    repository: string,
    branch: string,
    installationId: number,
  ): Promise<unknown>;
  getInstallationRepositories(
    installationId: number,
  ): Promise<Array<{ id: number; full_name: string }>>;
}

export function createGithubApi(options: {
  appId: number;
  privateKey: string;
  apiUrl: string;
}): GithubApi {
  const tokens = new Map<number, { value: string; expiresAt: number }>();

  async function appJwt(): Promise<string> {
    const key = await importPKCS8(
      options.privateKey.replace(/\\n/g, "\n"),
      "RS256",
    );
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
  };
}
