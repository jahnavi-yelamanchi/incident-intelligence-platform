import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

const tokenResponseSchema = z.object({ token: z.string().min(1), expires_at: z.string().datetime() });
const contentResponseSchema = z.array(z.object({ type: z.literal("file"), path: z.string().min(1), download_url: z.string().url().nullable() }));

export type GitHubAppConfig = { appId: string; privateKey: string };

export async function createGitHubAppJwt(config: GitHubAppConfig, now = Math.floor(Date.now() / 1_000)) {
  const key = await importPKCS8(config.privateKey.replace(/\\n/g, "\n"), "RS256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(config.appId)
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 9 * 60)
    .sign(key);
}

export async function createInstallationToken(config: GitHubAppConfig, installationId: string) {
  const jwt = await createGitHubAppJwt(config);
  const response = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`, { method: "POST", headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw Object.assign(new Error("GitHub installation token request failed."), { statusCode: 502 });
  return tokenResponseSchema.parse(await response.json());
}

export async function fetchRepositoryMarkdown(token: string, repository: string, path = "") {
  const response = await fetch(`https://api.github.com/repos/${repository}/contents/${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw Object.assign(new Error("GitHub repository content request failed."), { statusCode: 502 });
  const entries = contentResponseSchema.parse(await response.json());
  const markdown = entries.filter((entry) => /(^|\/)(readme|runbook|operat.*|oncall).*\.md$/i.test(entry.path) && entry.download_url).slice(0, 50);
  return Promise.all(markdown.map(async (entry) => ({ path: entry.path, content: await (await fetch(entry.download_url!, { signal: AbortSignal.timeout(10_000) })).text() })));
}
