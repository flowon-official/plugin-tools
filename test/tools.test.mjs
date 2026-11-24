// plugin-tools' own tests: node --test test/
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, test } from 'node:test';
import { appJwt } from '../bin/app-token.mjs';
import { addEntry, nextVersion } from '../bin/bump-version.mjs';
import { section } from '../bin/release-notes.mjs';
import { updateEntry } from '../bin/update-catalog.mjs';
import { entryProblems, tagCommit, verifyRemote } from '../bin/verify-catalog.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha = 'a'.repeat(40);
const url = 'https://github.com/flowon-official/logic-fabric-dataverse-plugin.git';
const manifest = { name: 'logic-fabric-dataverse', version: '0.10.0', description: 'Build Logic Fabric for Dataverse solutions.' };

describe('update-catalog', () => {
  test('points the entry at the release and keeps its other fields and the other entries', () => {
    const marketplace = {
      name: 'flowon',
      plugins: [
        { name: 'logic-fabric-dataverse', source: './plugins/logic-fabric-dataverse', description: 'old', category: 'development' },
        { name: 'flowon-dynamics', source: './plugins/flowon-dynamics', description: 'CLI' },
      ],
    };

    const updated = updateEntry(marketplace, manifest, { url, ref: 'v0.10.0', sha });

    assert.deepEqual(updated.plugins[0], {
      name: 'logic-fabric-dataverse',
      source: { source: 'url', url, ref: 'v0.10.0', sha },
      description: manifest.description,
      category: 'development',
    });
    assert.deepEqual(updated.plugins[1], marketplace.plugins[1]);
    assert.equal(updated.name, 'flowon');
  });

  test('adds a plugin the catalog doesn\'t list yet', () => {
    assert.equal(updateEntry({ plugins: [] }, manifest, { url, ref: 'v0.10.0', sha }).plugins.length, 1);
  });

  test('refuses a tag that isn\'t the version, a short commit and a URL that isn\'t https', () => {
    assert.throws(() => updateEntry({ plugins: [] }, manifest, { url, ref: 'v0.9.0', sha }), /isn't the plugin's version/);
    assert.throws(() => updateEntry({ plugins: [] }, manifest, { url, ref: 'v0.10.0', sha: 'abc123' }), /40-character/);
    assert.throws(() => updateEntry({ plugins: [] }, manifest, { url: 'git@github.com:o/r.git', ref: 'v0.10.0', sha }), /https/);
  });
});

describe('verify-catalog', () => {
  test('a pinned url entry passes the local checks', () => {
    assert.deepEqual(entryProblems({ name: 'p', source: { source: 'url', url, ref: 'v1.2.3', sha } }), []);
  });

  test('a folder path, a github source, a branch, a short commit and a subfolder are refused', () => {
    assert.match(entryProblems({ name: 'p', source: './plugins/p' })[0], /must be/);
    assert.match(entryProblems({ name: 'p', source: { source: 'github', repo: 'o/r', ref: 'v1.0.0', sha } })[0], /Codex skips/);
    assert.match(entryProblems({ name: 'p', source: { source: 'url', url, ref: 'main', sha } }).join(), /release tag/);
    assert.match(entryProblems({ name: 'p', source: { source: 'url', url, ref: 'v1.0.0', sha: 'abc' } }).join(), /40-character/);
    assert.match(entryProblems({ name: 'p', source: { source: 'url', url, ref: 'v1.0.0', sha, path: 'plugins/p' } }).join(), /root/);
  });

  test('a release resolves when its tag points at the commit and the plugin there has its name and version', () => {
    const repo = mkdtempSync(join(tmpdir(), 'plugin-'));
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    const release = version => {
      writeFileSync(join(repo, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'p', version }));
      git('add', '-A');
      git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', version);
      return git('rev-parse', 'HEAD');
    };

    git('init', '-q');
    mkdirSync(join(repo, '.claude-plugin'));
    const first = release('1.0.0');
    git('tag', 'v1.0.0');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'tag', '-a', '-m', 'annotated', 'v1.0.1', release('1.0.1'));
    const url = pathToFileURL(repo).href;

    assert.deepEqual(verifyRemote({ name: 'p', source: { source: 'url', url, ref: 'v1.0.0', sha: first } }, false), []);
    assert.deepEqual(verifyRemote({ name: 'p', source: { source: 'url', url, ref: 'v1.0.1', sha: git('rev-parse', 'HEAD') } }, false), []);
    assert.match(verifyRemote({ name: 'p', source: { source: 'url', url, ref: 'v1.0.0', sha: git('rev-parse', 'HEAD') } }, false).join(), /points at/);
    assert.match(verifyRemote({ name: 'q', source: { source: 'url', url, ref: 'v1.0.0', sha: first } }, false).join(), /is named p/);
    assert.match(verifyRemote({ name: 'p', source: { source: 'url', url, ref: 'v2.0.0', sha: first } }, false).join(), /has no tag v2\.0\.0/);
  });

  test('an annotated tag resolves to the commit it points at', () => {
    const lsRemote = `${'b'.repeat(40)}\trefs/tags/v1.0.0\n${sha}\trefs/tags/v1.0.0^{}`;
    assert.equal(tagCommit(lsRemote, 'v1.0.0'), sha);
    assert.equal(tagCommit(`${sha}\trefs/tags/v1.0.0`, 'v1.0.0'), sha);
    assert.equal(tagCommit('', 'v1.0.0'), undefined);
  });
});

describe('bump-version', () => {
  test('steps the version', () => {
    assert.equal(nextVersion('0.10.0', 'patch'), '0.10.1');
    assert.equal(nextVersion('0.10.3', 'minor'), '0.11.0');
    assert.equal(nextVersion('1.4.2', 'major'), '2.0.0');
    assert.equal(nextVersion('1.4.2', '1.5.0'), '1.5.0');
    assert.throws(() => nextVersion('1.0.0', 'next'), /patch, minor, major/);
  });

  test('puts the new entry first, under the title', () => {
    const changelog = '# Changelog\n\n## 1.0.0 (2026-11-20)\n\n- First.\n';
    assert.equal(addEntry(changelog, '1.0.1', 'Synced the CLI skill.', '2026-11-24'),
      '# Changelog\n\n## 1.0.1 (2026-11-24)\n\n- Synced the CLI skill.\n\n## 1.0.0 (2026-11-20)\n\n- First.\n');
    assert.equal(addEntry(null, '1.0.0', 'First.', '2026-11-24'), '# Changelog\n\n## 1.0.0 (2026-11-24)\n\n- First.\n');
  });
});

test('release-notes: the version\'s changelog entry, without its heading', () => {
  const changelog = '# Changelog\n\n## 0.10.0 (2026-11-25)\n\n- Codex and Copilot.\n- Stages.\n\n## 0.9.1\n\n- Old.\n';
  assert.equal(section(changelog, '0.10.0'), '- Codex and Copilot.\n- Stages.');
  assert.equal(section(changelog, '0.10'), null);
  assert.equal(section(changelog, '1.0.0'), null);
});

test('app-token: the App\'s token is an RS256 JWT the App\'s key verifies, issued by the App', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = appJwt(12345, privateKey.export({ type: 'pkcs1', format: 'pem' }), 1_000_000);
  const [header, payload, signature] = jwt.split('.');

  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iat: 999_940, exp: 1_000_540, iss: '12345' });
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
  assert.ok(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, signature, 'base64url'));
});
