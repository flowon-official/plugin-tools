#!/usr/bin/env node
// Opens a pull request, or finds the one already open from the same branch, and prints its URL.
//
//   GH_TOKEN=<token> node open-pr.mjs --repo <owner/name> --head <branch> [--base main] --title "<title>" [--body "<text>"]
import { pathToFileURL } from 'node:url';

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

export async function openPullRequest({ token, repo, head, base = 'main', title, body = '' }) {
  const [owner] = repo.split('/');
  const open = await github(`/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`, token);

  if (open.length) {
    return open[0].html_url;
  }

  const created = await github(`/repos/${repo}/pulls`, token, { method: 'POST', body: JSON.stringify({ head, base, title, body }) });
  return created.html_url;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = name => (args.indexOf(`--${name}`) >= 0 ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const token = process.env.GH_TOKEN;

  if (!token || !option('repo') || !option('head') || !option('title')) {
    console.error('Set GH_TOKEN, and give --repo, --head and --title.');
    process.exit(2);
  }

  console.log(await openPullRequest({ token, repo: option('repo'), head: option('head'), base: option('base'), title: option('title'), body: option('body') }));
}
