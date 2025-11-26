# 🏗️ feat: Add Hooks and Skills Support + Optional Nested Organization

## Overview

Add support for the missing `.factory/` resource types (`hooks/` and `skills/`) and optionally support nested directory organization to match `.claude/` structure capabilities.

## Current vs Target Structure

### Current State
```
.factory/
├── commands/           # ✅ Supported (flat only)
│   ├── plan.md
│   └── review.md
└── droids/             # ✅ Supported (flat only)
    ├── researcher.md
    └── reviewer.md
```

### Target State
```
.factory/
├── commands/           # ✅ Existing (optionally nested)
│   ├── plan.md
│   └── workflows/      # Optional nesting
│       └── deploy.md
├── droids/             # ✅ Existing (optionally nested)
│   ├── researcher.md
│   └── review/         # Optional nesting
│       └── security.md
├── hooks/              # 🆕 NEW
│   ├── pre-commit.md
│   └── post-install.md
└── skills/             # 🆕 NEW (directory-based)
    └── frontend-design/
        ├── SKILL.md
        └── examples/
```

### Mapping to Claude Code

| `.factory/` (droid-factory) | `.claude/` (Claude Code) | Notes |
|-----------------------------|--------------------------|-------|
| `.factory/commands/` | `.claude/commands/` | Both support nesting |
| `.factory/droids/` | `.claude/agents/` | Different names, same purpose |
| `.factory/hooks/` | `.claude/hooks/` | NEW - to be added |
| `.factory/skills/` | `.claude/skills/` | NEW - to be added |

**Key Point:** Keep `droids/` name (that's Factory's terminology). Don't rename to `agents/`.

## Problem Statement

### Missing Resource Types
1. **No hooks support** - Cannot install lifecycle hooks from marketplace
2. **No skills support** - Cannot install skills from marketplace

### Optional: Flat Structure Limitation
3. **Marketplace plugins lose organization** - Nested structures get flattened
4. **Example:** EveryInc/every-marketplace has `agents/review/security.md` → gets flattened to `droids/security.md`

## Proposed Solution

### Phase 1: Add Hooks and Skills (REQUIRED)

**Add two new resource types:**
- `.factory/hooks/` - Lifecycle hooks (single `.md` files)
- `.factory/skills/` - Skills (directories with `SKILL.md`)

**Implementation:**
```javascript
// lib/resource-types.js (NEW)
const RESOURCE_TYPES = {
  commands: {
    dirName: 'commands',
    fileType: 'single',      // Single .md file
    extension: '.md'
  },
  droids: {
    dirName: 'droids',
    fileType: 'single',
    extension: '.md'
  },
  hooks: {                   // NEW
    dirName: 'hooks',
    fileType: 'single',
    extension: '.md'
  },
  skills: {                  // NEW
    dirName: 'skills',
    fileType: 'directory',   // Directory with SKILL.md
    mainFile: 'SKILL.md'
  }
};
```

**CLI Updates:**
```bash
# New flags
droid-factory --hooks all
droid-factory --hooks pre-commit,post-install
droid-factory --skills frontend-design,dhh-ruby-style
droid-factory --only-hooks
droid-factory --only-skills
```

### Phase 2: Optional Nested Structure Support

**Two approaches:**

#### Option A: Always Flatten (Simplest - Current Behavior)
```
Marketplace: agents/review/security.md
Installs to: .factory/droids/security.md  (flat)
```
- **Pros:** Simple, no code changes to discovery
- **Cons:** Loses organizational context

#### Option B: Preserve Structure (Optional Flag)
```
Marketplace: agents/review/security.md
Installs to: .factory/droids/review/security.md  (nested)
```
- **Pros:** Preserves plugin organization
- **Cons:** Need nested directory support

**Recommended:** Start with Option A (flatten), add Option B if users request.

## Implementation Plan

### Phase 1: Add Hooks and Skills (Week 1)

**Day 1-2: Resource Type System**

**File: `lib/resource-types.js` (NEW)**
```javascript
const RESOURCE_TYPES = {
  commands: { dirName: 'commands', fileType: 'single', extension: '.md' },
  droids: { dirName: 'droids', fileType: 'single', extension: '.md' },
  hooks: { dirName: 'hooks', fileType: 'single', extension: '.md' },
  skills: { dirName: 'skills', fileType: 'directory', mainFile: 'SKILL.md' }
};

function getResourceDir(scope, type) {
  const base = scope === 'personal' ? expandHome('~/.factory') : './.factory';
  const config = RESOURCE_TYPES[type];
  return path.join(base, config.dirName);
}

module.exports = { RESOURCE_TYPES, getResourceDir };
```

**Update: `lib/fs-utils.js`**
```javascript
const { RESOURCE_TYPES } = require('./resource-types');

// Generic discovery for all types
function discoverResources(baseDir, type) {
  const config = RESOURCE_TYPES[type];

  if (config.fileType === 'single') {
    return discoverMarkdownFiles(baseDir);
  } else if (config.fileType === 'directory') {
    return discoverSkills(baseDir);
  }
}

// Existing: Discover .md files (commands, droids, hooks)
function discoverMarkdownFiles(baseDir) {
  if (!fs.existsSync(baseDir)) return [];

  return fs.readdirSync(baseDir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      name: f.replace('.md', ''),
      path: f,
      fullPath: path.join(baseDir, f)
    }));
}

// NEW: Discover skill directories
function discoverSkills(baseDir) {
  if (!fs.existsSync(baseDir)) return [];

  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(entry => {
      if (!entry.isDirectory()) return false;
      const skillMd = path.join(baseDir, entry.name, 'SKILL.md');
      return fs.existsSync(skillMd);
    })
    .map(entry => ({
      name: entry.name,
      path: entry.name,
      fullPath: path.join(baseDir, entry.name),
      isSkill: true
    }));
}
```

**Day 3-4: CLI Integration**

**Update: `lib/args.js`**
```javascript
function parseArgs(argv) {
  const args = {
    // Existing
    commands: undefined,
    droids: undefined,
    onlyCommands: false,
    onlyDroids: false,

    // NEW
    hooks: undefined,
    skills: undefined,
    onlyHooks: false,
    onlySkills: false,

    // Existing flags
    scope: 'personal',
    yes: false,
    force: false,
    dryRun: false,
    // ...
  };

  // Parse --hooks and --skills flags
  // ...

  return args;
}
```

**Update: `lib/cli.js`**
```javascript
const { getResourceDir, RESOURCE_TYPES } = require('./resource-types');

async function run() {
  const args = parseArgs(process.argv);

  // Discover all four types
  const resources = {};
  for (const type of Object.keys(RESOURCE_TYPES)) {
    const dir = getResourceDir(args.scope, type);
    resources[type] = discoverResources(dir, type);
  }

  // Selection (existing logic + hooks/skills)
  const selected = {
    commands: resolveSelection(args.commands, resources.commands),
    droids: resolveSelection(args.droids, resources.droids),
    hooks: resolveSelection(args.hooks, resources.hooks),      // NEW
    skills: resolveSelection(args.skills, resources.skills)    // NEW
  };

  // Installation (existing logic handles all types)
  for (const [type, items] of Object.entries(selected)) {
    const destDir = getResourceDir(args.scope, type);

    for (const item of items) {
      const config = RESOURCE_TYPES[type];

      if (config.fileType === 'single') {
        // Copy single file
        await copyFile(item.src, path.join(destDir, item.path));
      } else if (config.fileType === 'directory') {
        // Copy directory (skill)
        await copyDirectory(item.src, path.join(destDir, item.path));
      }
    }
  }
}
```

**Day 5: Marketplace Integration**

**Update: `lib/marketplace.js`**
```javascript
async function scanPlugin(pluginPath, overrides = {}) {
  const scan = {};

  for (const type of Object.keys(RESOURCE_TYPES)) {
    const config = RESOURCE_TYPES[type];
    const resourceDir = path.join(
      pluginPath,
      overrides[type] || config.dirName
    );

    scan[type] = fs.existsSync(resourceDir)
      ? await discoverResources(resourceDir, type)
      : [];
  }

  return scan; // { commands: [], droids: [], hooks: [], skills: [] }
}
```

**Update: `lib/marketplace-planner.js`**
```javascript
function computeMarketplacePlan(selectedPlugins, scope) {
  const plan = { commands: [], droids: [], hooks: [], skills: [] };

  for (const plugin of selectedPlugins) {
    for (const type of Object.keys(RESOURCE_TYPES)) {
      const resources = plugin[type] || [];
      const destDir = getResourceDir(scope, type);

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

**Week 2: Testing & Documentation**

**Tests:**
```javascript
// test/resource-types.test.js
describe('Resource Types', () => {
  test('getResourceDir returns correct path for hooks', () => {
    const dir = getResourceDir('personal', 'hooks');
    expect(dir).toContain('.factory/hooks');
  });

  test('getResourceDir returns correct path for skills', () => {
    const dir = getResourceDir('personal', 'skills');
    expect(dir).toContain('.factory/skills');
  });
});

// test/discovery.test.js
describe('Discovery', () => {
  test('discoverSkills finds directories with SKILL.md', () => {
    // Create temp skill: temp/frontend-design/SKILL.md
    const skills = discoverSkills(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('frontend-design');
  });

  test('discoverSkills ignores directories without SKILL.md', () => {
    // Create temp dir without SKILL.md
    const skills = discoverSkills(tempDir);
    expect(skills).toHaveLength(0);
  });
});

// test/marketplace.test.js
describe('Marketplace', () => {
  test('scanPlugin discovers hooks and skills', async () => {
    const scan = await scanPlugin(pluginPath);
    expect(scan.hooks).toBeDefined();
    expect(scan.skills).toBeDefined();
  });
});
```

**Documentation:**
- Update README with hooks and skills sections
- Add examples of installing hooks and skills
- Update CLI help text

### Phase 2: Optional Nested Support (Future - If Requested)

**Only implement if users specifically request it.**

**Add `--preserve-structure` flag:**
```bash
droid-factory --marketplace EveryInc/every-marketplace \
  --plugins compounding-engineering \
  --preserve-structure  # Keeps nested dirs
```

**Implementation (if needed):**
```javascript
// In discoverMarkdownFiles - add recursive option
function discoverMarkdownFiles(baseDir, recursive = false) {
  if (!recursive) {
    // Current: flat scan
    return fs.readdirSync(baseDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({ name: f.replace('.md', ''), path: f }));
  }

  // Recursive scan (preserves structure)
  const results = [];

  function walk(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath);
      } else if (entry.name.endsWith('.md')) {
        results.push({
          name: entry.name.replace('.md', ''),
          path: relPath,  // Preserves nested path
          fullPath: path.join(dir, relPath)
        });
      }
    }
  }

  walk(baseDir);
  return results;
}
```

## File Changes Summary

### New Files
- `lib/resource-types.js` (~40 LOC) - Resource type configuration
- `test/resource-types.test.js` - Tests
- `test/discovery-skills.test.js` - Tests

### Modified Files
- `lib/fs-utils.js` - Add `discoverSkills()` (~30 LOC)
- `lib/cli.js` - Four-type support (~40 LOC modified)
- `lib/args.js` - Add `--hooks` and `--skills` flags (~20 LOC)
- `lib/marketplace.js` - Scan all four types (~20 LOC)
- `lib/marketplace-planner.js` - Plan all four types (~20 LOC)
- `README.md` - Document hooks and skills
- `package.json` - Version bump

**Total: ~200 new LOC, ~100 modified LOC**

## Acceptance Criteria

### Functional
- [ ] Can install hooks to `.factory/hooks/`
- [ ] Can install skills to `.factory/skills/`
- [ ] Skills are directories with `SKILL.md`
- [ ] Marketplace plugins with hooks/skills install correctly
- [ ] CLI accepts `--hooks` and `--skills` flags
- [ ] `--only-hooks` and `--only-skills` flags work
- [ ] Existing commands and droids still work (no breaking changes)

### Non-Functional
- [ ] Installation <2s for 20 resources
- [ ] No breaking changes for existing users
- [ ] Clear error messages

### Quality
- [ ] >80% test coverage for new code
- [ ] Tested on macOS, Linux, Windows
- [ ] EveryInc/every-marketplace installs correctly

## Timeline

**Week 1: Core Implementation**
- Days 1-2: Resource types + discovery
- Days 3-4: CLI integration
- Day 5: Marketplace integration

**Week 2: Polish**
- Days 1-3: Testing
- Days 4-5: Documentation + release prep

**Total: 2 weeks, 1 engineer**

## Risk Assessment

**Low Risk Changes:**
- Adding hooks and skills (new functionality, no breaking changes)
- Using existing patterns (commands and droids work the same way)

**No Breaking Changes:**
- Existing commands and droids installations unchanged
- Backward compatible
- Additive only

## Success Metrics

- Zero complaints about broken installations
- Users can install all EveryInc/every-marketplace resources
- Installation success rate >99%

## Decision: Nested Structure Support

**NOT included in initial implementation** because:
1. Current flat structure works fine
2. No user complaints about organization
3. Can add later if requested (non-breaking)
4. Keeps implementation simple

**Can revisit** if:
- Users specifically request nested organization
- Marketplace plugins require structure preservation
- Evidence that flat structure causes confusion

## Examples

### Installing Hooks
```bash
# Interactive
droid-factory
# Select hooks from list

# CLI
droid-factory --hooks pre-commit,post-install
droid-factory --hooks all
droid-factory --only-hooks
```

### Installing Skills
```bash
# Interactive
droid-factory
# Select skills from list

# CLI
droid-factory --skills frontend-design,dhh-ruby-style
droid-factory --skills all
droid-factory --only-skills
```

### Installing from Marketplace
```bash
droid-factory --marketplace EveryInc/every-marketplace \
  --plugins compounding-engineering \
  --hooks all \
  --skills all
```

Results in:
```
.factory/
├── commands/
│   ├── plan.md
│   └── review.md
├── droids/
│   ├── researcher.md
│   └── reviewer.md
├── hooks/
│   ├── pre-commit.md
│   └── post-install.md
└── skills/
    ├── frontend-design/
    │   └── SKILL.md
    └── dhh-ruby-style/
        └── SKILL.md
```

---

**This plan is intentionally minimal:**
- Adds missing resource types (hooks, skills)
- Keeps flat structure (current behavior)
- ~300 LOC total
- 2 weeks implementation
- No breaking changes
- Can add nested support later if needed
