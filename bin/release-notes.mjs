#!/usr/bin/env node
// Prints the release notes of a plugin's current version: its changelog entry, or one line naming the release.
//
//   node release-notes.mjs [<plugin folder>]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function section(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  // The version, then a space, a date in brackets or the end: 0.10 isn't 0.10.0.
  const start = lines.findIndex(line => new RegExp(`^## ${version.replace(/\./g, '\\.')}(?=[ (]|$)`).test(line));

  if (start < 0) {
    return null;
  }

  const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = resolve(process.argv[2] ?? '.');
  const manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'));
  const changelog = join(dir, 'CHANGELOG.md');
  const notes = existsSync(changelog) ? section(readFileSync(changelog, 'utf8'), manifest.version) : null;

  console.log(notes || `Release ${manifest.name} ${manifest.version}.`);
}
