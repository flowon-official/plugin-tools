#!/usr/bin/env bash
# Moves one plugin out of a repository of several (plugins/<name>/) into a repository of its own, with the history of
# its folder and its release tags: <name>-v<version> becomes v<version> on the same content. Nothing is pushed.
#
#   split-plugin.sh <clone of the old repository> <plugin name> <folder for the new repository>
#
# Afterwards, check that each new tag has the old tag's plugin folder exactly (the script does), add the new
# repository's own files (ports/config.json, CHANGELOG.md, workflows from templates/plugin), and push.
set -euo pipefail

old=$(cd "$1" && pwd)
plugin=$2
new=$3

git -C "$old" subtree split --quiet --prefix="plugins/$plugin" -b "split/$plugin" >/dev/null

mkdir -p "$new"
git -C "$new" init -q -b main
git -C "$new" pull -q "$old" "split/$plugin"

for tag in $(git -C "$old" tag --list "$plugin-v*"); do
  commit=$(git -C "$old" subtree split --quiet --prefix="plugins/$plugin" "$tag")
  version=${tag#"$plugin-v"}
  git -C "$new" tag "v$version" "$commit"

  # The new tag's tree must be the old tag's plugin folder.
  if [ "$(git -C "$new" rev-parse "v$version^{tree}")" != "$(git -C "$old" rev-parse "$tag:plugins/$plugin")" ]; then
    echo "v$version doesn't match $tag's plugins/$plugin." >&2
    exit 1
  fi

  echo "$tag -> v$version ($commit)"
done

git -C "$old" branch -q -D "split/$plugin"
