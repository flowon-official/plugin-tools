#!/usr/bin/env node
// Points a plugin's catalog entry at a release: its repository, tag and commit. The entry's description follows the
// plugin's manifest. A plugin the catalog doesn't list yet is added at the end.
//
//   node update-catalog.mjs --catalog <catalog folder> --plugin <plugin folder> --url <git URL> --ref <tag> --sha <commit>
//
// Entries use the url source, which Claude Code, Codex and GitHub Copilot all read (Codex has no github source type and
// skips such entries), pinned by tag and full commit.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKETPLACE = join('.claude-plugin', 'marketplace.json');

export function updateEntry(marketplace, manifest, { url, ref, sha }) {
  if (!/^https:\/\/.+\.git$/.test(url ?? '')) {
    throw new Error(`The url must be an https git URL ending in .git, not '${url}'.`);
  }

  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) {
    throw new Error(`The sha must be a full 40-character commit, not '${sha}'.`);
  }

  if (ref !== `v${manifest.version}`) {
    throw new Error(`The tag ${ref} isn't the plugin's version ${manifest.version} (expected v${manifest.version}).`);
  }

  const entry = { name: manifest.name, source: { source: 'url', url, ref, sha }, description: manifest.description };
  const plugins = marketplace.plugins ?? [];
  const at = plugins.findIndex(p => p.name === manifest.name);

  if (at < 0) {
    plugins.push(entry);
  } else {
    // Keep the entry's other fields (category, tags and so on).
    plugins[at] = { ...plugins[at], ...entry };
  }

  return { ...marketplace, plugins };
}

function option(args, name) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const catalog = resolve(option(args, 'catalog') ?? '.');
  const plugin = resolve(option(args, 'plugin') ?? '.');
  const file = join(catalog, MARKETPLACE);
  const manifest = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'));
  const updated = updateEntry(JSON.parse(readFileSync(file, 'utf8')), manifest, { url: option(args, 'url'), ref: option(args, 'ref'), sha: option(args, 'sha') });

  writeFileSync(file, JSON.stringify(updated, null, 2) + '\n');
  console.log(`${manifest.name}: the catalog now points at ${option(args, 'ref')} (${option(args, 'sha')}).`);
}
