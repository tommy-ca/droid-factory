# 🔧 Update: Hooks Implementation - Keep Subdirectory Support

## Revised Understanding

The previous implementation was **correct**. There are TWO different hook concepts:

1. **Factory Droid Internal Hooks** (JSON in `~/.factory/settings.json`)
   - Runtime lifecycle hooks
   - Execute shell commands at specific events
   - Configured via JSON in settings.json

2. **Marketplace Plugin Hooks** (Files in `.factory/hooks/` and `.claude/hooks/`)
   - Distributed as files/scripts in marketplace plugins
   - Can be documentation, shell scripts, or hook definitions
   - Installed to `.factory/hooks/` subdirectory
   - Users can reference these from their `settings.json`

## Architecture

### Correct Implementation (KEEP CURRENT)
```
.factory/
├── commands/           # Slash commands
├── droids/            # Subagents
├── hooks/             # ✅ Hook files from marketplace
│   ├── pre-commit.sh
│   ├── post-install.sh
│   └── validator.md
└── skills/            # Skills directories
    └── frontend-design/
        └── SKILL.md
```

### How Hooks Work Together

1. **Marketplace Distribution**: Plugins include hook files in `.claude/hooks/`
2. **Installation**: droid-factory installs to `.factory/hooks/`
3. **Configuration**: User references installed hooks in `settings.json`:

```json
// ~/.factory/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/home/user/.factory/hooks/pre-commit.sh"
          }
        ]
      }
    ]
  }
}
```

## Implementation Status

### ✅ Already Implemented (KEEP)
- Hooks discovery from marketplace plugins
- Hooks installation to `.factory/hooks/`
- Hooks displayed in verbose install plan
- CLI flags: `--hooks`, `--only-hooks`

### 🐛 Recent Bug Fixes (COMPLETED)
- Fixed missing `skills` field in plugin records (commit `cde655a`)
- Fixed remote skills filtering (commit `cde655a`)
- Fixed hooks/skills display in verbose output (commit `a55f3ce`)

### ✅ Current Status
- Commands: Working ✓
- Droids: Working ✓
- Hooks: Working ✓ (correctly installs to `.factory/hooks/`)
- Skills: Working ✓

## Testing Status

### Completed Tests
1. ✅ Remote skills filtering (EveryInc/every-marketplace - 11 skills discovered, 0 installed)
2. ✅ Local skills installation (test marketplace - 1 skill installed correctly)
3. ✅ Local hooks installation (test marketplace - 1 hook installed correctly)
4. ✅ Verbose output displays all resource types

### Test Results
```bash
# Test with local marketplace
$ node bin/droid-factory.js --marketplace /tmp/test-marketplace --plugins test-plugin --verbose

Install plan (marketplace):
  Commands:
    (none)
  Droids:
    (none)
  Hooks:
    - test-hook [test-plugin] ← local
  Skills:
    - test-skill [test-plugin] ← local

Installing to:
  /home/user/.factory/hooks
  /home/user/.factory/skills

✓ Completed — 2 created, 0 overwritten, 0 skipped.
```

## Documentation Updates Needed

### README.md - Add Hooks Section

```markdown
## Resource Types

### Supported
- ✅ **Commands** - Slash commands (`.factory/commands/`)
- ✅ **Droids** - Subagents (`.factory/droids/`)
- ✅ **Hooks** - Hook scripts and definitions (`.factory/hooks/`)
- ✅ **Skills** - Directory-based skills (`.factory/skills/`)

### Installing Hooks

Marketplace plugins can include hooks that you install to `.factory/hooks/`:

```bash
# Install all hooks from a plugin
droid-factory --marketplace EveryInc/every-marketplace \
  --plugins compounding-engineering \
  --hooks all

# Install specific hooks
droid-factory --hooks pre-commit,post-install

# Install only hooks (skip commands, droids, skills)
droid-factory --only-hooks
```

### Using Installed Hooks

After installing hooks to `.factory/hooks/`, reference them in your Factory Droid settings:

1. Open `~/.factory/settings.json`
2. Add hook configuration:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/home/user/.factory/hooks/pre-commit.sh"
          }
        ]
      }
    ]
  }
}
```

3. Enable hooks in Factory Droid: `/settings` → "Hooks" → "Enabled"

See the [Factory Droid Hooks Guide](https://docs.factory.ai/cli/configuration/hooks-guide) for details on hook events and matchers.
```

## Implementation Plan

### Task 1: Update README Documentation
- Add hooks section to resource types
- Document hook installation workflow
- Explain relationship between `.factory/hooks/` files and `settings.json`
- Link to Factory Droid hooks guide

### Task 2: Verify All Tests Pass
- Test hooks installation with local marketplace
- Test hooks installation with remote marketplace (EveryInc/every-marketplace)
- Verify hooks can be referenced from `settings.json`

### Task 3: Clean Up Test Files
- Remove test marketplace from `/tmp/test-marketplace`
- Clean up installed test hooks/skills from `~/.factory/`

## File Changes Summary

### Modified Files
- `README.md` - Add hooks documentation (~50 LOC added)

### No Code Changes Needed
- All code is working correctly
- Hooks installation logic is correct
- Skills installation logic is correct
- Display logic is correct

## Acceptance Criteria

- [x] Hooks are discovered from marketplace plugins
- [x] Hooks are installed to `.factory/hooks/`
- [x] Hooks are displayed in verbose output
- [x] CLI accepts `--hooks` flags
- [x] Skills installation works
- [ ] README documents hooks usage
- [ ] Clear examples of referencing hooks in settings.json

## Success Metrics

- Hooks installation success rate = 100%
- Clear documentation path for using installed hooks
- Users understand relationship between `.factory/hooks/` and `settings.json`

## References

- [Factory Droid Hooks Guide](https://docs.factory.ai/cli/configuration/hooks-guide)
- Current PR: #1 (feat/add-hooks-and-skills-support)
- Original plan: `plans/add-hooks-and-skills-support.md`
- Bug fixes: commits `cde655a`, `a55f3ce`
