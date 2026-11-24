#!/usr/bin/env node
// Checks a catalog before it ships: every entry is a url source pinned by tag and full commit, the tag points at that
// commit, and the plugin there has the entry's name and the tag's version. With --validate, Claude Code's validator
// runs on each plugin too (the claude CLI must be installed).
//
//   node verify-catalog.mjs [<catalog folder>] [--validate]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MARKETPLACE } from './update-catalog.mjs';

// What can be checked without the network.
export function entryProblems(entry) {
  const source = entry.source;
  const problems = [];

  if (!source || typeof source !== 'object' || source.source !== 'url') {
    return [`${entry.name}: the source must be { "source": "url", "url", "ref", "sha" } (Codex skips "github" sources; a folder path ships every commit).`];
  }

  if (!/^https:\/\/.+\.git$/.test(source.url ?? '')) {
    problems.push(`${entry.name}: the url must be an https git URL ending in .git.`);
  }

  if (!/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(source.ref ?? '')) {
    problems.push(`${entry.name}: the ref must be a release tag like v1.2.3.`);
  }

  if (!/^[0-9a-f]{40}$/.test(source.sha ?? '')) {
    problems.push(`${entry.name}: the sha must be a full 40-character commit.`);
  }

  if (source.path) {
    problems.push(`${entry.name}: the plugin must be at its repository's root (no path).`);
  }

  return problems;
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// The commit a tag points at (an annotated tag's ^{} line wins).
export function tagCommit(lsRemote, ref) {
  const lines = lsRemote.split('\n').map(line => line.split('\t')).filter(([, name]) => name);
  const peeled = lines.find(([, name]) => name === `refs/tags/${ref}^{}`);
  const direct = lines.find(([, name]) => name === `refs/tags/${ref}`);
  return (peeled ?? direct)?.[0];
}

export function verifyRemote(entry, validate) {
  const { url, ref, sha } = entry.source;
  const problems = [];
  const tagged = tagCommit(git(['ls-remote', url, `refs/tags/${ref}`, `refs/tags/${ref}^{}`]), ref);

  if (!tagged) {
    return [`${entry.name}: ${url} has no tag ${ref}.`];
  }

  if (tagged !== sha) {
    problems.push(`${entry.name}: the tag ${ref} points at ${tagged}, not ${sha}.`);
  }

  const dir = mkdtempSync(join(tmpdir(), 'catalog-'));

  try {
    git(['init', '-q'], dir);
    git(['fetch', '-q', '--depth', '1', url, sha], dir);
    git(['checkout', '-q', 'FETCH_HEAD'], dir);

    const manifestFile = join(dir, '.claude-plugin', 'plugin.json');

    if (!existsSync(manifestFile)) {
      return [...problems, `${entry.name}: ${sha} has no .claude-plugin/plugin.json at the repository's root.`];
    }

    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));

    if (manifest.name !== entry.name) {
      problems.push(`${entry.name}: the plugin at ${sha} is named ${manifest.name}.`);
    }

    if (`v${manifest.version}` !== ref) {
      problems.push(`${entry.name}: the plugin at ${sha} is version ${manifest.version}, not ${ref}.`);
    }

    for (const port of ['.codex-plugin/plugin.json', '.github/plugin/plugin.json']) {
      if (existsSync(join(dir, port)) && JSON.parse(readFileSync(join(dir, port), 'utf8')).version !== manifest.version) {
        problems.push(`${entry.name}: ${port} at ${sha} doesn't have version ${manifest.version}.`);
      }
    }

    if (validate) {
      try {
        execFileSync('claude', ['plugin', 'validate', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
      } catch (error) {
        problems.push(`${entry.name}: claude plugin validate failed: ${(error.stdout || error.message).trim()}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const catalog = resolve(args.find(a => !a.startsWith('--')) ?? '.');
  const validate = args.includes('--validate');
  const marketplace = JSON.parse(readFileSync(join(catalog, MARKETPLACE), 'utf8'));
  const problems = [];

  // Codex reads .agents/plugins/marketplace.json before .claude-plugin/marketplace.json, and only the first it finds.
  if (existsSync(join(catalog, '.agents', 'plugins', 'marketplace.json'))) {
    problems.push('.agents/plugins/marketplace.json would hide the shared catalog from Codex: remove it.');
  }

  const names = new Set();

  for (const entry of marketplace.plugins ?? []) {
    if (names.has(entry.name)) {
      problems.push(`${entry.name} is listed twice.`);
    }

    names.add(entry.name);
    const local = entryProblems(entry);
    problems.push(...(local.length ? local : verifyRemote(entry, validate)));
  }

  if (problems.length) {
    console.error(`The catalog has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  console.log(`The catalog's ${names.size} plugin(s) resolve and match their tags.`);
}
