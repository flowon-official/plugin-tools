# Flowon plugin tools

The shared tooling of Flowon's AI plugins. Each plugin lives in a repository of its own, written once for Claude Code;
these tools build its packages for Codex and GitHub Copilot, check it, and release it to the catalog,
[flowon-official/ai-plugins](https://github.com/flowon-official/ai-plugins), the `flowon` marketplace all three clients
install from.

| | |
|---|---|
| `bin/build-ports.mjs` | Writes a plugin's Codex and Copilot packages from its Claude Code source (`--check` fails when they're out of date) |
| `checks/plugin.test.mjs` | The checks every plugin runs: packages current, manifests consistent, hooks and agents valid, a changelog entry for the version |
| `bin/bump-version.mjs` | Bumps a plugin's version, adds a changelog entry, rewrites the packages |
| `bin/release-notes.mjs` | The current version's changelog entry |
| `bin/update-catalog.mjs` | Points a plugin's catalog entry at a release: repository, tag and commit |
| `bin/verify-catalog.mjs` | Checks every catalog entry: pinned, the tag on that commit, the plugin's name and version, Claude Code's validator |
| `bin/app-token.mjs`, `bin/open-pr.mjs` | A token of the release GitHub App and a pull request, for pipelines outside GitHub Actions |
| `.github/workflows/plugin-ci.yml` | Reusable: checks a plugin repository |
| `.github/workflows/plugin-release.yml` | Reusable: tags a new version, publishes the release, opens the catalog pull request |
| `.github/workflows/catalog-verify.yml` | Reusable: checks the catalog |
| `templates/` | The workflows a plugin repository and the catalog copy in, and the Azure DevOps steps that propose the CLI skill to its plugin |
| `migrate/split-plugin.sh` | Moves a plugin out of a repository of several, with its history and tags |

## A plugin repository

The plugin sits at the repository's root: `.claude-plugin/plugin.json`, `skills/`, and as it needs `commands/`,
`agents/`, `hooks/`, `.mcp.json`. Add:

- `ports/config.json`, what the Claude manifest doesn't say (all optional):

  ```json
  {
    "short": "Build Dataverse logic safely",
    "category": "Developer Tools",
    "codexAgentPrefix": "logic_fabric",
    "servers": { "foundry": { "title": "Logic Foundry" } },
    "rewrites": [{ "pattern": "regular expression", "flags": "", "replacement": "text, {plugin} for the plugin's name" }]
  }
  ```

  `short` is Codex's short description (30 characters at most). Codex takes only lowercase letters, digits and
  underscores in an agent's name, so agents become `<codexAgentPrefix>_<agent>`, which also keeps them from replacing
  one of Codex's own (`explorer`). `servers` names each MCP server in `.mcp.json` in an agent's instructions for Codex.
- `CHANGELOG.md`, with a `## <version> (<date>)` entry per release: it becomes the release notes.
- `.github/workflows/` from `templates/plugin/`.
- Tests of its own, if any, as `tests/*.test.mjs` (Node's test runner).

After changing the plugin, write its packages, and commit them with the change:

```bash
node <plugin-tools>/bin/build-ports.mjs .
```

## Releasing

1. A pull request bumps the version and adds its changelog entry:
   `node <plugin-tools>/bin/bump-version.mjs . minor --note "What changed."` (or edit both yourself). CI checks it.
2. Merging it to `main` tags the commit `v<version>`, publishes a GitHub release with the changelog entry, and opens a
   pull request in the catalog that points the plugin's entry at that tag and commit.
3. A release owner merges the catalog pull request: that ships the release to everyone who installed the plugin from
   the `flowon` marketplace, in Claude Code, Codex and GitHub Copilot. Reverting it rolls the release back.

Every release needs a new version: Claude Code offers an update only when the version changes, and Codex caches a
plugin by its version.

A catalog entry is a `url` source pinned by tag and full commit, the one form all three clients read (Codex has no
`github` source type and skips such entries):

```json
{
  "name": "logic-fabric-dataverse",
  "source": { "source": "url", "url": "https://github.com/flowon-official/logic-fabric-dataverse-plugin.git", "ref": "v0.10.0", "sha": "<40-character commit>" },
  "description": "..."
}
```

The catalog holds nothing else: every commit to it makes Codex fetch it again and reinstall every plugin from it.

## One-time setup

- A GitHub App owned by the org (the release App), with *Contents* and *Pull requests* read and write, installed on
  the catalog and on each plugin repository that the Azure DevOps pipeline updates. Its ID goes in the org variable
  `FLOWON_RELEASE_APP_ID`, its private key in the org secret `FLOWON_RELEASE_APP_KEY`, both available to the plugin
  repositories.
- A team of release owners, `@flowon-official/plugin-release-owners`, as the catalog's code owners, with branch
  protection on the catalog's `main` that requires their review and the Verify check.
- Branch protection on each plugin repository's `main` that requires the CI check.
- For the CLI plugin: the App's ID and key in an Azure DevOps variable group (`FlowonReleaseAppId`,
  `FlowonReleaseAppKey`), and `templates/azure-pipelines/cli-plugin-sync.yml` in flowon-xrm's CLI release.

## Versions of these tools

Plugin repositories call the workflows at `@v1` and the workflows fetch the tools at `v1`. A compatible change moves
the `v1` tag (after a `v1.x.y` tag); a breaking one starts `v2`, and the plugin repositories move when they're ready.

## Tests

```bash
node --test test/*.test.mjs
PLUGIN_DIR=<plugin folder> node --test checks/plugin.test.mjs
```
