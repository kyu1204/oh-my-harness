import type { BuildingBlock } from "../types.js";

export const worktreeSetup: BuildingBlock = {
  id: "worktree-setup",
  name: "Worktree Setup",
  description: "Initializes new git worktrees with symlinked dependencies and copied config files",
  category: "automation",
  event: "WorktreeCreate",
  matcher: "",
  canBlock: false,
  params: [
    {
      name: "symlinkPaths",
      type: "string[]",
      description: "Paths to symlink from main worktree (heavy dependencies)",
      required: false,
      default: ["node_modules", ".venv", "vendor", "target", ".build"],
    },
    {
      name: "copyPaths",
      type: "string[]",
      description: "Paths to hard-copy from main worktree (config files)",
      required: false,
      default: [".env", ".env.local"],
    },
    {
      name: "installCommand",
      type: "string",
      description: "Package install command to run if symlink source missing",
      required: false,
      default: "",
    },
  ],
  tags: ["worktree", "git", "dependencies", "symlink", "automation"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)

# Parse worktree info from stdin
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.worktree_path // empty' 2>/dev/null)
if [[ -z "$WORKTREE_PATH" ]]; then
  echo "oh-my-harness: worktree-setup — no worktree_path in input" >&2
  exit 0
fi

# Find the main worktree (parent repo)
MAIN_WORKTREE=$(git -C "$WORKTREE_PATH" worktree list --porcelain 2>/dev/null | head -1 | sed 's/^worktree //')
if [[ -z "$MAIN_WORKTREE" ]]; then
  echo "oh-my-harness: worktree-setup — cannot determine main worktree" >&2
  exit 0
fi

echo "oh-my-harness: worktree-setup — setting up $WORKTREE_PATH"

# Symlink heavy directories from main worktree
SYMLINKS=({{#each symlinkPaths}}"{{{this}}}" {{/each}})
for rel in "\${SYMLINKS[@]}"; do
  [[ -z "$rel" ]] && continue
  src="$MAIN_WORKTREE/$rel"
  dst="$WORKTREE_PATH/$rel"
  if [[ -e "$src" && ! -e "$dst" ]]; then
    mkdir -p "$(dirname "$dst")"
    ln -s "$src" "$dst"
    echo "  symlinked: $rel"
  fi
done

# Hard-copy config files from main worktree
COPIES=({{#each copyPaths}}"{{{this}}}" {{/each}})
for rel in "\${COPIES[@]}"; do
  [[ -z "$rel" ]] && continue
  src="$MAIN_WORKTREE/$rel"
  dst="$WORKTREE_PATH/$rel"
  if [[ -f "$src" && ! -f "$dst" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "  copied: $rel"
  fi
done

# Run install command if provided and no symlinked deps exist
INSTALL_CMD="{{{installCommand}}}"
if [[ -n "$INSTALL_CMD" ]]; then
  first_symlink="\${SYMLINKS[0]}"
  if [[ -n "$first_symlink" && ! -e "$WORKTREE_PATH/$first_symlink" ]]; then
    echo "  running: $INSTALL_CMD"
    cd "$WORKTREE_PATH" && eval "$INSTALL_CMD"
  fi
fi

echo "oh-my-harness: worktree-setup complete"
exit 0`,
};
