#!/usr/bin/env node
// Bumps a plugin's version and adds a changelog entry, then rewrites the Codex and Copilot packages with it.
//
//   node bump-version.mjs [<plugin folder>] <patch|minor|major|x.y.z> [--note "<a line for the changelog>"]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function nextVersion(current, step) {
  if (/^\d+\.\d+\.\d+$/.test(step)) {
    return step;
  }

  const [major, minor, patch] = current.split('-')[0].split('.').map(Number);

  switch (step) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: throw new Error(`Give patch, minor, major or a version like 1.2.3, not '${step}'.`);
  }
}

// The changelog with a new entry on top, under the title if there is one.
export function addEntry(changelog, version, note, date) {
  const entry = `## ${version} (${date})\n\n- ${note}\n`;
  const text = changelog ?? '# Changelog\n';
  const firstEntry = text.search(/^## /m);

  return firstEntry < 0 ? `${text.trimEnd()}\n\n${entry}` : `${text.slice(0, firstEntry)}${entry}\n${text.slice(firstEntry)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const noteAt = args.indexOf('--note');
  const note = noteAt >= 0 ? args[noteAt + 1] : null;
  const positional = args.filter((a, i) => !a.startsWith('--') && (noteAt < 0 || i !== noteAt + 1));
  const [dir, step] = positional.length > 1 ? [resolve(positional[0]), positional[1]] : [resolve('.'), positional[0]];
  const manifestFile = join(dir, '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const version = nextVersion(manifest.version, step);

  writeFileSync(manifestFile, JSON.stringify({ ...manifest, version }, null, 2) + '\n');

  if (note) {
    const changelogFile = join(dir, 'CHANGELOG.md');
    const current = existsSync(changelogFile) ? readFileSync(changelogFile, 'utf8') : null;
    writeFileSync(changelogFile, addEntry(current, version, note, new Date().toISOString().slice(0, 10)));
  }

  execFileSync('node', [join(dirname(fileURLToPath(import.meta.url)), 'build-ports.mjs'), dir], { stdio: 'inherit' });
  console.log(`${manifest.name}: ${manifest.version} → ${version}`);
}
