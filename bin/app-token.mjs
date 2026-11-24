#!/usr/bin/env node
// Prints a short-lived GitHub token of the org's release GitHub App, limited to the given repositories. For pipelines
// outside GitHub Actions (flowon-xrm's Azure DevOps release); GitHub Actions use actions/create-github-app-token.
//
//   GITHUB_APP_ID=<id> GITHUB_APP_PRIVATE_KEY=<PEM> node app-token.mjs --owner flowon-official --repo flowon-dynamics-plugin
//
// The token is printed and nothing else: hand it to the pipeline as a secret (in Azure DevOps,
// ##vso[task.setvariable variable=GH_TOKEN;issecret=true]<token>), never to a log.
import { createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const base64url = value => Buffer.from(value).toString('base64url');

// The App's own JSON Web Token (RS256), valid for nine minutes and backdated a minute for clock drift.
export function appJwt(appId, privateKey, now = Math.floor(Date.now() / 1000)) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey, 'base64url');

  return `${header}.${payload}.${signature}`;
}

async function github(path, token, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'flowon-plugin-tools', ...init.headers },
  });

  if (!response.ok) {
    throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export async function installationToken({ appId, privateKey, owner, repositories }) {
  const jwt = appJwt(appId, privateKey);
  const installation = await github(`/orgs/${owner}/installation`, jwt);
  const result = await github(`/app/installations/${installation.id}/access_tokens`, jwt, {
    method: 'POST',
    body: JSON.stringify({ repositories }),
  });

  return result.token;
}

// The App's bot as a git author: "<slug>[bot]" and its no-reply address, so its commits show as the App's.
export async function appIdentity({ appId, privateKey }) {
  const app = await github('/app', appJwt(appId, privateKey));
  const response = await fetch(`https://api.github.com/users/${encodeURIComponent(`${app.slug}[bot]`)}`, { headers: { 'User-Agent': 'flowon-plugin-tools' } });
  const user = await response.json();

  return { name: `${app.slug}[bot]`, email: `${user.id}+${app.slug}[bot]@users.noreply.github.com` };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const owner = args[args.indexOf('--owner') + 1];
  const repositories = args.flatMap((a, i) => (a === '--repo' ? [args[i + 1]] : []));
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    console.error('Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.');
    process.exit(2);
  }

  try {
    if (args.includes('--identity')) {
      // node app-token.mjs --identity: the bot's name and e-mail, one per line.
      const { name, email } = await appIdentity({ appId, privateKey });
      console.log(`${name}\n${email}`);
    } else if (args.indexOf('--owner') < 0 || repositories.length === 0) {
      console.error('Give --owner and at least one --repo (or --identity).');
      process.exitCode = 2;
    } else {
      process.stdout.write(await installationToken({ appId, privateKey, owner, repositories }));
    }
  } catch (error) {
    // One line, and a normal exit: an unhandled rejection while requests are open crashes node on Windows.
    console.error(/\/installation: 404/.test(error.message)
      ? `GitHub found no installation of the GitHub App ${appId} on ${owner}: install the App on the repositories it needs, and check the App ID and key.`
      : error.message);
    process.exitCode = 1;
  }
}
