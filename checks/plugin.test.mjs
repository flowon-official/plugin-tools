// The checks every plugin repository runs (CI calls them through the plugin-ci workflow): the Codex and Copilot packages
// are current with their Claude Code source, and what they point to exists.
//   PLUGIN_DIR=<plugin folder> node --test <plugin-tools>/checks/plugin.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const tools = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(process.env.PLUGIN_DIR ?? '.');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const claude = read(join(dir, '.claude-plugin', 'plugin.json'));

test('the Codex and Copilot packages are current', () => {
  execFileSync('node', [join(tools, 'bin', 'build-ports.mjs'), '--check', dir], { stdio: 'pipe' });
});

test('the version is a semantic version (Claude Code compares it as text, Codex caches by it)', () => {
  assert.match(claude.version ?? '', /^\d+\.\d+\.\d+(-[\w.]+)?$/);
});

test('every manifest has the Claude manifest\'s name and version, and its paths exist', () => {
  for (const manifest of [join(dir, '.codex-plugin', 'plugin.json'), join(dir, '.github', 'plugin', 'plugin.json')]) {
    const port = read(manifest);
    assert.equal(port.name, claude.name);
    assert.equal(port.version, claude.version);

    for (const path of [port.skills, port.agents, port.hooks, port.interface?.logo, port.extensions?.['com.openai']?.onboardingSkill].flat().filter(Boolean)) {
      assert.ok(existsSync(join(dir, path)), `${manifest}: ${path} doesn't exist`);
    }
  }
});

test('the Codex manifest keeps Codex from importing the Claude commands and MCP servers itself', () => {
  const codex = read(join(dir, '.codex-plugin', 'plugin.json'));

  if (existsSync(join(dir, 'commands'))) {
    assert.deepEqual(codex.commands, []);
  }

  if (existsSync(join(dir, '.mcp.json'))) {
    assert.deepEqual(codex.mcpServers, {});
  }
});

test('each Codex agent has a name Codex can spawn, not one of Codex\'s own, and every agent a skill names exists', () => {
  const folder = join(dir, 'ports', 'codex', 'agents');
  const names = existsSync(folder)
    ? readdirSync(folder).map(file => readFileSync(join(folder, file), 'utf8').match(/^name = "([^"]+)"$/m)?.[1])
    : [];

  for (const name of names) {
    assert.match(name ?? '', /^[a-z0-9_]+$/);
    assert.ok(!['default', 'worker', 'explorer'].includes(name), `${name} replaces one of Codex's own agents`);
  }

  const skills = join(dir, 'ports', 'skills');
  const text = existsSync(skills)
    ? readdirSync(skills, { recursive: true }).filter(f => f.endsWith('SKILL.md')).map(f => readFileSync(join(skills, f), 'utf8')).join('\n')
    : '';

  for (const [, shared, codex] of text.matchAll(/`[\w-]+:([a-z-]+)` agent \(`(\w+)` in Codex\)/g)) {
    assert.ok(names.includes(codex), `a skill names the Codex agent ${codex}, which doesn't exist`);
    assert.ok(existsSync(join(dir, 'ports', 'copilot', 'agents', `${shared}.agent.md`)), `a skill names the agent ${shared}, which doesn't exist`);
  }
});

for (const client of ['codex', 'copilot']) {
  const file = join(dir, 'ports', client, 'hooks.json');

  test(`each ${client} hook runs an existing hook script as that client`, { skip: !existsSync(file) }, () => {
    const commands = Object.values(read(file).hooks).flat().flatMap(group => group.hooks).map(hook => hook.command);
    assert.ok(commands.length > 0);

    for (const command of commands) {
      const script = command.match(/'hooks','([\w-]+\.mjs)'/)?.[1];
      assert.ok(script && existsSync(join(dir, 'hooks', script)), `${command} runs no existing script`);
      assert.match(command, new RegExp(`--client ${client}\\b`));
    }
  });
}

test('no generated skill or agent tells another client to use Claude Code\'s tools', () => {
  const ports = join(dir, 'ports');
  const files = existsSync(ports) ? readdirSync(ports, { recursive: true }).map(f => join(ports, f)).filter(f => /\.(md|toml)$/.test(f)) : [];

  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /mcp__plugin_|\$ARGUMENTS|\$\{CLAUDE_PLUGIN_ROOT\}|`AskUserQuestion`/, file);
  }
});

test('the changelog has an entry for this version', { skip: !existsSync(join(dir, 'CHANGELOG.md')) }, () => {
  assert.match(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), new RegExp(`^## ${claude.version.replace(/\./g, '\\.')}(?=[ (]|$)`, 'm'));
});
