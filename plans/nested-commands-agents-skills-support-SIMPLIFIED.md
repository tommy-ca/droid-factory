# 🏗️ feat: Align .factory Structure with Claude Code + Add Hooks/Skills Support

## Overview

**Simple Goal:** Make droid-factory install resources to the correct directories that Claude Code expects:
- `.factory/commands/` → Claude Code commands
- `.factory/agents/` → Claude Code agents (not "droids")
- `.factory/hooks/` → Claude Code hooks (NEW)
- `.factory/skills/` → Claude Code skills (NEW)

**Optional Enhancement:** Preserve nested directory structure from marketplace plugins (e.g., EveryInc/every-marketplace).

## Problem Statement

**Current Issues:**
1. Uses `droids/` but Claude Code expects `agents/`
2. No support for `hooks/` or `skills/` resource types
3. Flattens marketplace plugin structures during installation

**What Users Need:**
- Install all four Claude Code resource types
- Resources go to correct directories
- Marketplace plugins keep their organization

## Proposed Solution

### Directory Structure Mapping

| droid-factory Directory | Claude Code Resource Type | File Structure |
|------------------------|---------------------------|----------------|
| `.factory/commands/` | Commands (`/command-name`) | Single `.md` file |
| `.factory/agents/` | Agents (`subagent_type: 'name'`) | Single `.md` file |
| `.factory/hooks/` | Lifecycle Hooks | Single `.md` file |
| `.factory/skills/` | Skills (`/skill skill-name`) | Directory with `SKILL.md` |

### Example Structure

```
.factory/
├── commands/
│   ├── code-review.md              # /code-review
│   └── workflows/                  # Optional nesting
│       └── plan.md                 # /workflows:plan
├── agents/
│   ├── researcher.md               # subagent_type: 'researcher'
│   └── review/                     # Optional nesting
│       └── security.md             # subagent_type: 'review:security'
├── hooks/
│   ├── pre-commit.md
│   └── post-install.md
└── skills/
    └── frontend-design/            # /skill frontend-design
        ├── SKILL.md                # Required
        └── examples/               # Optional
```

### Migration from droids/ to agents/

**Simple approach:**
```javascript
// Check both directories, prefer agents/
function getAgentsDir(scope) {
  const base = scope === 'personal' ? '~/.factory' : './.factory';
  const agentsPath = path.join(base, 'agents');
  const droidsPath = path.join(base, 'droids');

  if (fs.existsSync(agentsPath)) {
    return agentsPath;
  }

  if (fs.existsSync(droidsPath)) {
    console.warn('⚠️  Using legacy droids/ directory. Run: droid-factory migrate');
    return droidsPath;
  }

  return agentsPath; // Create new agents/ dir
}
```

**Migration command:**
```bash
droid-factory migrate --droids-to-agents
```

Renames directory if safe, errors if conflicts.

## Technical Implementation

### Phase 1: Add Resource Types (3 days)

**File: `lib/resource-types.js` (NEW)**
```javascript
const RESOURCE_TYPES = {
  commands: {
    dirName: 'commands',
    fileExtension: '.md',
    isDirectory: false
  },
  agents: {
    dirName: 'agents',
    fileExtension: '.md',
    isDirectory: false,
    legacyDirName: 'droids' // Backward compat
  },
  hooks: {
    dirName: 'hooks',
    fileExtension: '.md',
    isDirectory: false
  },
  skills: {
    dirName: 'skills',
    mainFile: 'SKILL.md',
    isDirectory: true
  }
};

function getResourceDir(scope, type) {
  const base = scope === 'personal' ? expandHome('~/.factory') : './.factory';
  const config = RESOURCE_TYPES[type];

  // Check new directory
  const newPath = path.join(base, config.dirName);
  if (fs.existsSync(newPath)) return newPath;

  // Check legacy directory
  if (config.legacyDirName) {
    const legacyPath = path.join(base, config.legacyDirName);
    if (fs.existsSync(legacyPath)) {
      console.warn(`⚠️  DEPRECATED: Using ${config.legacyDirName}/ directory. Please rename to ${config.dirName}/`);
      return legacyPath;
    }
  }

  return newPath;
}
```

**Update: `lib/fs-utils.js`**
```javascript
// Enhanced to support all four types
function discoverResources(baseDir, type) {
  const config = RESOURCE_TYPES[type];

  if (config.isDirectory) {
    // Skills: scan for directories with SKILL.md
    return discoverSkills(baseDir);
  } else {
    // Commands/Agents/Hooks: scan for .md files
    return discoverMarkdownFiles(baseDir);
  }
}

function discoverMarkdownFiles(baseDir) {
  if (!fs.existsSync(baseDir)) return [];

  const results = [];

  function walk(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath, relPath); // Recursive
      } else if (entry.name.endsWith('.md')) {
        results.push({
          name: entry.name.replace('.md', ''),
          path: relPath,
          fullPath: fullPath
        });
      }
    }
  }

  walk(baseDir);
  return results;
}

function discoverSkills(baseDir) {
  if (!fs.existsSync(baseDir)) return [];

  const results = [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillMdPath = path.join(baseDir, entry.name, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        results.push({
          name: entry.name,
          path: entry.name,
          fullPath: path.join(baseDir, entry.name),
          isSkill: true
        });
      }
    }
  }

  return results;
}
```

**Update: `lib/cli.js`**
```javascript
// Add hooks and skills to installation flow
async function run() {
  // ... existing code ...

  // Discover all four types
  const commandsDir = getResourceDir(scope, 'commands');
  const agentsDir = getResourceDir(scope, 'agents');
  const hooksDir = getResourceDir(scope, 'hooks');    // NEW
  const skillsDir = getResourceDir(scope, 'skills');  // NEW

  const availableCommands = discoverResources(commandsDir, 'commands');
  const availableAgents = discoverResources(agentsDir, 'agents');
  const availableHooks = discoverResources(hooksDir, 'hooks');      // NEW
  const availableSkills = discoverResources(skillsDir, 'skills');   // NEW

  // ... selection and installation ...
}
```

**Update: `lib/args.js`**
```javascript
function parseArgs(argv) {
  const args = {
    // ... existing ...
    agents: undefined,       // NEW name
    droids: undefined,       // DEPRECATED (alias)
    hooks: undefined,        // NEW
    skills: undefined,       // NEW
    onlyAgents: false,       // NEW
    onlyHooks: false,        // NEW
    onlySkills: false,       // NEW
  };

  // ... parse flags ...

  // Handle deprecated --droids flag
  if (args.droids !== undefined) {
    console.warn('⚠️  --droids is deprecated. Use --agents instead.');
    if (args.agents === undefined) {
      args.agents = args.droids;
    }
  }

  return args;
}
```

### Phase 2: Marketplace Integration (2 days)

**Update: `lib/marketplace.js`**
```javascript
async function scanPlugin(pluginPath, overrides = {}) {
  const commands = await scanResourceType(pluginPath, 'commands', overrides);
  const agents = await scanResourceType(pluginPath, 'agents', overrides);
  const hooks = await scanResourceType(pluginPath, 'hooks', overrides);      // NEW
  const skills = await scanResourceType(pluginPath, 'skills', overrides);    // NEW

  return { commands, agents, hooks, skills };
}

async function scanResourceType(pluginPath, type, overrides) {
  const config = RESOURCE_TYPES[type];
  const resourceDir = path.join(pluginPath, overrides[type] || config.dirName);

  if (!fs.existsSync(resourceDir)) return [];

  return discoverResources(resourceDir, type);
}
```

**Update: `lib/marketplace-planner.js`**
```javascript
function computeMarketplacePlan(selectedPlugins, destDirs) {
  const plan = {
    commands: [],
    agents: [],
    hooks: [],   // NEW
    skills: []   // NEW
  };

  for (const plugin of selectedPlugins) {
    // Process each resource type
    for (const type of ['commands', 'agents', 'hooks', 'skills']) {
      const resources = plugin[type] || [];
      const destDir = destDirs[type];

      for (const resource of resources) {
        plan[type].push({
          plugin: plugin.name,
          name: resource.name,
          src: resource.fullPath,
          dest: path.join(destDir, resource.path),
          isSkill: resource.isSkill || false
        });
      }
    }
  }

  return plan;
}
```

### Phase 3: Migration Command (1 day)

**File: `lib/migration.js` (NEW)**
```javascript
async function migrateDroidsToAgents(scope) {
  const base = scope === 'personal' ? expandHome('~/.factory') : './.factory';
  const droidsPath = path.join(base, 'droids');
  const agentsPath = path.join(base, 'agents');

  // Nothing to migrate
  if (!fs.existsSync(droidsPath)) {
    console.log('ℹ️  No droids/ directory found - nothing to migrate');
    return;
  }

  // Conflict - manual resolution needed
  if (fs.existsSync(agentsPath)) {
    console.error('❌ Both droids/ and agents/ exist.');
    console.error('   Please manually merge or remove one directory.');
    process.exit(1);
  }

  // Simple rename
  await fs.promises.rename(droidsPath, agentsPath);
  console.log(`✅ Migrated: ${droidsPath} → ${agentsPath}`);
}
```

**Add CLI command:**
```javascript
// In lib/cli.js
if (args.migrate) {
  if (args.droidsto agents) {
    await migrateDroidsToAgents(args.scope);
    return;
  }
}
```

### Phase 4: Testing & Documentation (2 days)

**Tests to add:**
```javascript
// test/resource-types.test.js
test('getResourceDir returns agents/ when exists');
test('getResourceDir falls back to droids/ with warning');
test('getResourceDir creates agents/ if neither exists');

// test/discovery.test.js
test('discoverMarkdownFiles finds flat .md files');
test('discoverMarkdownFiles finds nested .md files');
test('discoverSkills finds directories with SKILL.md');
test('discoverSkills ignores directories without SKILL.md');

// test/migration.test.js
test('migrateDroidsToAgents renames directory');
test('migrateDroidsToAgents errors if both exist');
test('migrateDroidsToAgents skips if no droids/ directory');

// test/marketplace.test.js
test('scanPlugin discovers all four resource types');
test('marketplace installation preserves nested structure');
```

**Documentation updates:**
- README: Add hooks and skills sections
- README: Update droids → agents terminology
- Add migration guide for droids → agents
- Update CLI help text with all four types

## Acceptance Criteria

### Functional
- [ ] Can install commands to `.factory/commands/`
- [ ] Can install agents to `.factory/agents/`
- [ ] Can install hooks to `.factory/hooks/`
- [ ] Can install skills to `.factory/skills/`
- [ ] Legacy `droids/` directory still works with warning
- [ ] Migration command renames `droids/` → `agents/`
- [ ] Nested structures preserved from marketplace
- [ ] CLI accepts `--agents`, `--hooks`, `--skills` flags
- [ ] `--droids` flag works as alias with deprecation warning

### Non-Functional
- [ ] Installation completes in <2s for 20 resources
- [ ] No breaking changes for existing users
- [ ] Clear error messages for all failure cases

### Quality Gates
- [ ] All new code has unit tests (>80% coverage)
- [ ] Manual testing on macOS, Linux, Windows
- [ ] EveryInc/every-marketplace plugin installs correctly
- [ ] Migration tested with real user data

## Implementation Timeline

**Week 1:**
- Days 1-3: Phase 1 (Resource types + discovery)
- Days 4-5: Phase 2 (Marketplace integration)

**Week 2:**
- Day 1: Phase 3 (Migration)
- Days 2-3: Phase 4 (Testing & docs)
- Days 4-5: Bug fixes, polish, release prep

**Total: 2 weeks, 1-2 engineers**

## Files to Modify

### New Files
- `lib/resource-types.js` - Resource type configuration (~50 LOC)
- `lib/migration.js` - Migration utilities (~30 LOC)
- `test/resource-types.test.js` - Tests
- `test/migration.test.js` - Tests

### Modified Files
- `lib/fs-utils.js` - Enhanced discovery (~100 LOC added)
- `lib/cli.js` - Four-type support (~50 LOC modified)
- `lib/args.js` - New flags (~30 LOC added)
- `lib/marketplace.js` - Four-type scanning (~40 LOC modified)
- `lib/marketplace-planner.js` - Four-type planning (~30 LOC modified)
- `README.md` - Documentation updates
- `package.json` - Version bump

**Total new/modified code: ~400 LOC** (vs. 2,800 in original plan)

## Migration Guide for Users

### If you have a `droids/` directory:

**Option 1: Automatic migration**
```bash
droid-factory migrate --droids-to-agents
```

**Option 2: Manual migration**
```bash
mv ~/.factory/droids ~/.factory/agents
# or
mv ./.factory/droids ./.factory/agents
```

**Option 3: Do nothing**
The legacy `droids/` directory will continue to work with a deprecation warning.

## References

### Internal
- Current codebase: `/home/tommyk/projects/ai/agents/droid-factory/`
- Existing discovery: `lib/fs-utils.js:8-14`
- Existing installation: `lib/cli.js:219-294`

### External
- EveryInc/every-marketplace - Reference implementation
- Claude Code resource types: agents, commands, hooks, skills
- Node.js fs.cpSync - For directory copying

## Risk Mitigation

### Low-Risk Changes
- Adding hooks and skills support (new functionality, no breaking changes)
- Marketplace structure preservation (enhancement, not replacement)

### Medium-Risk Changes
- droids → agents migration (mitigated by legacy support)

### Mitigation Strategies
- Keep legacy `droids/` support indefinitely
- Clear deprecation warnings
- Simple migration command
- Comprehensive testing on all platforms

## Success Metrics

- **Installation success rate:** >99% (low risk - mostly additive)
- **Migration success rate:** >99% (simple rename operation)
- **User complaints:** 0 about broken installations
- **Time to implement:** <2 weeks

## Alternative Considered: Do Nothing

**Pros:**
- Zero work
- No risk

**Cons:**
- Users cannot install hooks or skills
- Terminology confusion continues
- Marketplace compatibility limited

**Decision:** Implement - low risk, high value for users.

---

**This plan is intentionally simple:** ~400 LOC, 2 weeks, low risk, high compatibility.