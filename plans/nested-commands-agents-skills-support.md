# 🏗️ feat: Align .factory Structure with Claude Code Resources

## Overview

Update droid-factory to install resources into the correct `.factory/` directory structure that maps 1:1 with Claude Code's resource types: **agents**, **commands**, **hooks**, and **skills**. Add support for nested organization (optional) and preserve marketplace plugin structure during installation.

## Problem Statement / Motivation

**Current State:**
- droid-factory uses `droids/` directory but Claude Code expects `agents/`
- Missing support for `hooks/` and `skills/` resource types
- Flat directory structure only - marketplace plugins with nested organization get flattened
- Terminology mismatch causing user confusion

**User Impact:**
- Resources installed to wrong directories (droids vs agents)
- Cannot install hooks or skills from marketplace
- Loss of plugin organizational structure
- Confusion between droid-factory terminology and Claude Code terminology

**Business Value:**
- Correct installation paths for Claude Code compatibility
- Support all four Claude Code resource types
- Preserve marketplace plugin organization
- Clear 1:1 mapping between droid-factory and Claude Code

## Proposed Solution

### Four Resource Types Mapping to Claude Code

| droid-factory | Claude Code | Structure | Example Path |
|---------------|-------------|-----------|--------------|
| **commands** | Commands | Single `.md` file | `.factory/commands/plan.md` |
| **agents** | Agents | Single `.md` file | `.factory/agents/researcher.md` |
| **hooks** | Hooks | Single `.md` file | `.factory/hooks/pre-commit.md` |
| **skills** | Skills | Directory with `SKILL.md` | `.factory/skills/frontend-design/SKILL.md` |

### Directory Structure

```
.factory/
├── commands/
│   ├── code-review.md                    # Flat (backward compatible)
│   ├── release-notes.md
│   └── workflows/                        # Nested (new)
│       ├── plan.md                       # /workflows:plan
│       ├── review.md                     # /workflows:review
│       └── work.md                       # /workflows:work
│
├── agents/                               # Renamed from droids/
│   ├── security-reviewer.md              # Flat (backward compatible)
│   ├── review/                           # Category grouping
│   │   ├── code-quality-reviewer.md
│   │   ├── security-code-reviewer.md
│   │   └── performance-reviewer.md
│   ├── research/
│   │   ├── best-practices-researcher.md
│   │   └── framework-docs-researcher.md
│   └── workflow/
│       ├── bug-reproduction-validator.md
│       └── pr-comment-resolver.md
│
└── skills/                               # New directory-based type
    ├── frontend-design/
    │   ├── SKILL.md                      # Required
    │   ├── examples/                     # Optional
    │   └── templates/                    # Optional
    ├── dhh-ruby-style/
    │   └── SKILL.md
    └── git-worktree/
        └── SKILL.md
```

### Optional: Nested Organization

**Separator:** `:` (colon) for CLI arguments, `/` (slash) in filesystem
- Marketplace plugins can use subdirectories for organization
- CLI accepts both: `--commands workflows/plan` or `--commands workflows:plan`
- Filesystem preserves actual directory structure

**Examples:**
- File: `commands/workflows/plan.md`
- CLI: `--commands workflows:plan` or `--commands workflows/plan`
- Claude Code invocation: `/workflows:plan`

**Nesting Rules (if used):**
- **Maximum depth:** 2 levels recommended (per oclif best practices)
- **Allowed characters:** alphanumeric, hyphens (`-`), underscores (`_`)
- Subdirectories are OPTIONAL - flat structure still fully supported

## Technical Approach

### Architecture (Simplified)

**Core Components:**

1. **Resource Type Configuration**
   - Map droid-factory directories to Claude Code resource types
   - Support four types: commands, agents, hooks, skills
   - Legacy support: `droids/` → `agents/` with deprecation warning

2. **Discovery Layer** (`lib/fs-utils.js` - enhanced)
   - Scan `.factory/` for all four resource types
   - Optional: Recursive scanning for nested structures
   - Return flat list of resources with their types and paths

3. **Installation Layer** (`lib/cli.js` - enhanced)
   - Preserve directory structure from marketplace (if present)
   - Install to correct `.factory/` subdirectory based on type
   - Handle both files (commands/agents/hooks) and directories (skills)

4. **Migration Layer** (`lib/migration.js` - new, minimal)
   - Simple `droids/` → `agents/` directory rename
   - Fallback: Check both directories during discovery
   - Deprecation warning when using legacy path

5. **CLI Updates** (`lib/args.js`)
   - Add `--hooks` flag
   - Add `--skills` flag
   - Alias `--droids` to `--agents` with warning
   - Support nested paths: `--commands workflows/plan`

### Implementation Phases

#### Phase 1: Resource Type Alignment & Discovery

**Duration:** 1 week

**Deliverables:**

1. **Resource Type Configuration** (`lib/resource-types.js` - new)
   ```javascript
   // lib/namespace.js

   /**
    * Parse namespace string into parts
    * @param {string} namespace - e.g., 'workflows:plan'
    * @param {string} separator - default ':'
    * @returns {string[]} - ['workflows', 'plan']
    */
   function parseNamespace(namespace, separator = ':') {
     validateNamespace(namespace);
     return namespace.split(separator);
   }

   /**
    * Convert namespace to filesystem path
    * @param {string} namespace - e.g., 'workflows:plan'
    * @param {string} baseDir - base directory
    * @param {string} extension - file extension (e.g., '.md')
    * @returns {string} - absolute path
    */
   function namespaceToPath(namespace, baseDir, extension = '.md') {
     const parts = parseNamespace(namespace);
     validateDepth(parts); // Max 2 levels
     return path.join(baseDir, ...parts) + extension;
   }

   /**
    * Convert filesystem path to namespace
    * @param {string} fsPath - filesystem path
    * @param {string} baseDir - base directory
    * @param {string} separator - namespace separator
    * @returns {string} - namespace notation
    */
   function pathToNamespace(fsPath, baseDir, separator = ':') {
     const relative = path.relative(baseDir, fsPath);
     const withoutExt = relative.replace(/\.md$/, '');
     return withoutExt.split(path.sep).join(separator);
   }

   /**
    * Validate namespace format
    * @param {string} namespace
    * @throws {Error} if invalid
    */
   function validateNamespace(namespace) {
     // Alphanumeric, hyphens, underscores only
     const pattern = /^[a-z0-9_-]+(?::[a-z0-9_-]+)*$/i;
     if (!pattern.test(namespace)) {
       throw new Error(`Invalid namespace: ${namespace}. Use alphanumeric, hyphens, underscores only.`);
     }

     // No leading/trailing hyphens
     const parts = namespace.split(':');
     for (const part of parts) {
       if (part.startsWith('-') || part.endsWith('-')) {
         throw new Error(`Invalid namespace part: ${part}. Cannot start/end with hyphen.`);
       }
     }
   }

   /**
    * Validate namespace depth (max 2 levels)
    * @param {string[]} parts - namespace parts
    * @throws {Error} if too deep
    */
   function validateDepth(parts) {
     if (parts.length > 2) {
       throw new Error(`Namespace too deep: ${parts.join(':')}. Maximum 2 levels allowed.`);
     }
   }
   ```

2. **Type Configuration** (`lib/type-config.js`)
   ```javascript
   // lib/type-config.js

   const TYPE_CONFIG = {
     commands: {
       fileType: 'single',      // Single .md file
       extension: '.md',
       subdirSupport: true,
       legacyNames: []
     },
     agents: {
       fileType: 'single',
       extension: '.md',
       subdirSupport: true,
       legacyNames: ['droids']  // Backward compatibility
     },
     skills: {
       fileType: 'directory',   // Directory with SKILL.md
       mainFile: 'SKILL.md',
       subdirSupport: true,
       legacyNames: []
     }
   };

   module.exports = { TYPE_CONFIG };
   ```

3. **Enhanced Discovery** (`lib/fs-utils.js` - modify existing)
   ```javascript
   // lib/fs-utils.js - ENHANCED

   const { readdir, stat } = require('fs/promises');
   const { join } = require('path');
   const { TYPE_CONFIG } = require('./type-config');
   const { pathToNamespace } = require('./namespace');

   /**
    * Recursively discover resources of a given type
    * @param {string} baseDir - base directory
    * @param {string} type - 'commands' | 'agents' | 'skills'
    * @returns {Promise<Array>} - [{name, namespace, path, category, type}]
    */
   async function discoverResources(baseDir, type) {
     const config = TYPE_CONFIG[type];

     if (config.fileType === 'single') {
       return discoverFileResources(baseDir, type, config);
     } else if (config.fileType === 'directory') {
       return discoverDirectoryResources(baseDir, type, config);
     }
   }

   /**
    * Discover file-based resources (commands, agents)
    */
   async function discoverFileResources(baseDir, type, config, currentDir = '', results = []) {
     const fullPath = join(baseDir, currentDir);

     if (!fs.existsSync(fullPath)) return results;

     const entries = await readdir(fullPath, { withFileTypes: true });

     for (const entry of entries) {
       const relativePath = join(currentDir, entry.name);
       const fullEntryPath = join(fullPath, entry.name);

       if (entry.isDirectory() && config.subdirSupport) {
         // Recurse into subdirectories
         await discoverFileResources(baseDir, type, config, relativePath, results);
       } else if (entry.isFile() && entry.name.endsWith(config.extension)) {
         const basename = entry.name.replace(config.extension, '');

         // Build namespace
         const namespace = currentDir
           ? pathToNamespace(relativePath, '', ':').replace(config.extension, '')
           : basename;

         results.push({
           name: basename,
           namespace: namespace,
           path: relativePath,
           category: currentDir ? currentDir.split(path.sep)[0] : 'root',
           type: type
         });
       }
     }

     return results;
   }

   /**
    * Discover directory-based resources (skills)
    */
   async function discoverDirectoryResources(baseDir, type, config, currentDir = '', results = []) {
     const fullPath = join(baseDir, currentDir);

     if (!fs.existsSync(fullPath)) return results;

     const entries = await readdir(fullPath, { withFileTypes: true });

     for (const entry of entries) {
       if (entry.isDirectory()) {
         const relativePath = join(currentDir, entry.name);
         const skillMdPath = join(fullPath, entry.name, config.mainFile);

         if (fs.existsSync(skillMdPath)) {
           // This directory is a skill
           const namespace = currentDir
             ? pathToNamespace(relativePath, '', ':')
             : entry.name;

           results.push({
             name: entry.name,
             namespace: namespace,
             path: relativePath,
             category: currentDir ? currentDir.split(path.sep)[0] : 'root',
             type: type
           });
         } else if (config.subdirSupport) {
           // Recurse into category directories
           await discoverDirectoryResources(baseDir, type, config, relativePath, results);
         }
       }
     }

     return results;
   }

   /**
    * Legacy: List basenames (kept for backward compatibility)
    * Now delegates to new discovery system
    */
   function listBasenames(dir) {
     // Kept for backward compatibility
     // Delegates to discoverResources with type detection
     const type = dir.includes('commands') ? 'commands' : 'agents';
     const resources = await discoverResources(dir, type);
     return resources.map(r => r.name);
   }
   ```

**Success Criteria:**
- [ ] Namespace validation rejects invalid characters
- [ ] Namespace depth limited to 2 levels
- [ ] Path conversion handles nested structures correctly
- [ ] Discovery finds both flat and nested resources
- [ ] Type configuration correctly identifies file vs directory resources

**Test Cases:**
```javascript
// test/namespace.test.js
test('parseNamespace splits on colon', () => {
  expect(parseNamespace('workflows:plan')).toEqual(['workflows', 'plan']);
});

test('validateNamespace rejects special characters', () => {
  expect(() => validateNamespace('work@flows:plan')).toThrow();
});

test('validateDepth rejects >2 levels', () => {
  expect(() => validateDepth(['a', 'b', 'c'])).toThrow();
});

test('namespaceToPath converts correctly', () => {
  const result = namespaceToPath('workflows:plan', '/base');
  expect(result).toBe('/base/workflows/plan.md');
});

test('pathToNamespace converts correctly', () => {
  const result = pathToNamespace('/base/workflows/plan.md', '/base');
  expect(result).toBe('workflows:plan');
});

// test/discovery.test.js
test('discoverFileResources finds flat files', async () => {
  // Setup: Create temp directory with flat files
  const results = await discoverFileResources(tempDir, 'commands', config);
  expect(results).toContainEqual({
    name: 'plan',
    namespace: 'plan',
    path: 'plan.md',
    category: 'root',
    type: 'commands'
  });
});

test('discoverFileResources finds nested files', async () => {
  // Setup: Create temp directory with nested structure
  const results = await discoverFileResources(tempDir, 'commands', config);
  expect(results).toContainEqual({
    name: 'plan',
    namespace: 'workflows:plan',
    path: 'workflows/plan.md',
    category: 'workflows',
    type: 'commands'
  });
});

test('discoverDirectoryResources finds skills', async () => {
  // Setup: Create temp directory with skill structure
  const results = await discoverDirectoryResources(tempDir, 'skills', config);
  expect(results).toContainEqual({
    name: 'frontend-design',
    namespace: 'frontend-design',
    path: 'frontend-design',
    category: 'root',
    type: 'skills'
  });
});
```

#### Phase 2: Resolution & Installation

**Duration:** Sprint 2 (2 weeks)

**Deliverables:**

1. **Resolution Logic** (`lib/planner.js` - modify)
   ```javascript
   // lib/planner.js - ENHANCED

   const { namespaceToPath } = require('./namespace');
   const { discoverResources } = require('./fs-utils');

   /**
    * Resolve resource name to path with priority
    * Priority: 1. Root level, 2. Nested with namespace, 3. Auto-discovery
    */
   async function resolveResourcePath(type, name, baseDir) {
     // 1. Check root level (backward compatible)
     const rootPath = join(baseDir, `${name}.md`);
     if (fs.existsSync(rootPath)) {
       return { path: rootPath, namespace: name, foundAt: 'root' };
     }

     // 2. Parse namespace if contains colon
     if (name.includes(':')) {
       const nestedPath = namespaceToPath(name, baseDir);
       if (fs.existsSync(nestedPath)) {
         return { path: nestedPath, namespace: name, foundAt: 'nested' };
       }
     }

     // 3. Auto-discovery
     const discovered = await discoverResources(baseDir, type);
     const match = discovered.find(r =>
       r.name === name || r.namespace === name
     );

     if (match) {
       return {
         path: join(baseDir, match.path),
         namespace: match.namespace,
         foundAt: 'autodiscovery'
       };
     }

     // Not found - suggest similar
     const suggestions = findSimilar(name, discovered);
     throw new Error(
       `Resource "${name}" not found.\n` +
       (suggestions.length ? `Did you mean: ${suggestions.join(', ')}?` : '')
     );
   }

   function findSimilar(query, resources) {
     // Levenshtein distance or prefix matching
     return resources
       .filter(r =>
         r.name.includes(query) ||
         r.namespace.includes(query)
       )
       .slice(0, 3)
       .map(r => r.namespace);
   }
   ```

2. **Conflict Detection** (`lib/conflict-detector.js` - new)
   ```javascript
   // lib/conflict-detector.js

   /**
    * Detect namespace conflicts during installation
    */
   function detectConflicts(existingResources, newResources) {
     const conflicts = [];

     for (const newRes of newResources) {
       const existing = existingResources.find(e =>
         e.namespace === newRes.namespace
       );

       if (existing) {
         conflicts.push({
           type: 'exact',
           namespace: newRes.namespace,
           existing: existing.path,
           new: newRes.path,
           message: `Namespace '${newRes.namespace}' already exists`
         });
       }
     }

     return conflicts;
   }

   /**
    * Interactive conflict resolution
    */
   async function resolveConflicts(conflicts) {
     const resolutions = [];

     for (const conflict of conflicts) {
       console.log(`\nConflict detected: ${conflict.namespace}`);
       console.log(`  Existing: ${conflict.existing}`);
       console.log(`  New:      ${conflict.new}`);

       const { Select } = require('enquirer');
       const choice = await new Select({
         name: 'resolution',
         message: 'How would you like to resolve this conflict?',
         choices: [
           { name: 'overwrite', message: 'Overwrite existing (⚠️  data loss risk)' },
           { name: 'rename', message: 'Rename new resource' },
           { name: 'skip', message: 'Skip this resource' },
           { name: 'abort', message: 'Abort installation' }
         ]
       }).run();

       if (choice === 'abort') {
         throw new Error('Installation aborted by user');
       }

       if (choice === 'rename') {
         const { Input } = require('enquirer');
         const newName = await new Input({
           message: 'Enter new namespace:',
           initial: `${conflict.namespace}-new`
         }).run();

         resolutions.push({ ...conflict, resolution: 'rename', newName });
       } else {
         resolutions.push({ ...conflict, resolution: choice });
       }
     }

     return resolutions;
   }
   ```

3. **Installation with Structure Preservation** (`lib/cli.js` - modify)
   ```javascript
   // lib/cli.js - ENHANCED

   async function installResource(resource, targetBaseDir, options = {}) {
     const { TYPE_CONFIG } = require('./type-config');
     const config = TYPE_CONFIG[resource.type];

     // Build target path
     const targetPath = join(targetBaseDir, resource.path);

     // Check for conflicts unless force
     if (fs.existsSync(targetPath) && !options.force) {
       if (!options.yes) {
         // Interactive conflict resolution
         const conflict = {
           namespace: resource.namespace,
           existing: targetPath,
           new: resource.src || resource.path
         };
         const resolution = await resolveConflicts([conflict]);

         if (resolution[0].resolution === 'skip') {
           return 'skipped';
         }

         if (resolution[0].resolution === 'rename') {
           const newNamespace = resolution[0].newName;
           const newPath = namespaceToPath(newNamespace, targetBaseDir);
           targetPath = newPath;
         }
       }
     }

     // Create parent directories
     await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

     // Copy based on resource type
     if (config.fileType === 'single') {
       // Copy single file
       await fs.promises.copyFile(resource.src, targetPath);
       return 'written';
     } else if (config.fileType === 'directory') {
       // Copy entire directory (skill)
       await fs.promises.cp(resource.src, targetPath, {
         recursive: true,
         filter: (src, dest) => {
           // Skip hidden files except SKILL.md
           return !path.basename(src).startsWith('.') ||
                  path.basename(src) === 'SKILL.md';
         }
       });
       return 'written';
     }
   }
   ```

**Success Criteria:**
- [ ] Resolution finds resources at root, nested, and via auto-discovery
- [ ] Priority order enforced (root > nested > autodiscovery)
- [ ] Conflict detection identifies namespace collisions
- [ ] Interactive conflict resolution provides clear options
- [ ] Installation preserves directory structure
- [ ] Skills copied as entire directories with supporting files

**Test Cases:**
```javascript
// test/resolution.test.js
test('resolveResourcePath finds root level first', async () => {
  // Setup: Create both root and nested 'plan.md'
  const result = await resolveResourcePath('commands', 'plan', baseDir);
  expect(result.foundAt).toBe('root');
});

test('resolveResourcePath finds nested with namespace', async () => {
  const result = await resolveResourcePath('commands', 'workflows:plan', baseDir);
  expect(result.foundAt).toBe('nested');
  expect(result.path).toContain('workflows/plan.md');
});

test('resolveResourcePath uses autodiscovery as fallback', async () => {
  const result = await resolveResourcePath('commands', 'plan', baseDir);
  expect(result.foundAt).toBe('autodiscovery');
});

test('resolveResourcePath suggests similar on not found', async () => {
  await expect(resolveResourcePath('commands', 'plam', baseDir))
    .rejects.toThrow(/Did you mean: plan/);
});

// test/conflict-detection.test.js
test('detectConflicts identifies exact namespace match', () => {
  const existing = [{ namespace: 'workflows:plan', path: 'workflows/plan.md' }];
  const newRes = [{ namespace: 'workflows:plan', path: 'workflows/plan.md' }];

  const conflicts = detectConflicts(existing, newRes);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].type).toBe('exact');
});

// test/installation.test.js
test('installResource creates nested directories', async () => {
  const resource = {
    type: 'commands',
    namespace: 'workflows:plan',
    path: 'workflows/plan.md',
    src: '/source/plan.md'
  };

  await installResource(resource, targetBaseDir);
  expect(fs.existsSync(join(targetBaseDir, 'workflows/plan.md'))).toBe(true);
});

test('installResource copies skill directory', async () => {
  const resource = {
    type: 'skills',
    namespace: 'frontend-design',
    path: 'frontend-design',
    src: '/source/frontend-design'
  };

  await installResource(resource, targetBaseDir);
  expect(fs.existsSync(join(targetBaseDir, 'frontend-design/SKILL.md'))).toBe(true);
  expect(fs.existsSync(join(targetBaseDir, 'frontend-design/examples'))).toBe(true);
});
```

#### Phase 3: Migration & Backward Compatibility

**Duration:** Sprint 3 (1 week)

**Deliverables:**

1. **Migration Command** (`lib/migration.js` - new)
   ```javascript
   // lib/migration.js

   async function migrateDroidsToAgents(scope, options = {}) {
     const basePath = scope === 'personal' ? expandHome('~/.factory') : './.factory';
     const droidsPath = join(basePath, 'droids');
     const agentsPath = join(basePath, 'agents');

     // Validate preconditions
     if (!fs.existsSync(droidsPath)) {
       console.log('ℹ️  No migration needed (droids directory not found)');
       return { status: 'skip', reason: 'no_droids_dir' };
     }

     if (fs.existsSync(agentsPath) && !options.merge) {
       console.error('❌ Both "droids" and "agents" directories exist.');
       console.error('   Use --merge flag to merge, or manually resolve.');
       return { status: 'conflict', reason: 'both_exist' };
     }

     // Create backup
     const backupPath = join(basePath, `.backups/droids-${Date.now()}`);
     await fs.promises.mkdir(path.dirname(backupPath), { recursive: true });
     await fs.promises.cp(droidsPath, backupPath, { recursive: true });
     console.log(`📦 Backup created: ${backupPath}`);

     // Perform migration
     if (options.merge && fs.existsSync(agentsPath)) {
       // Merge mode: move droids into agents, resolve conflicts
       const droidsResources = await discoverResources(droidsPath, 'agents');
       const agentsResources = await discoverResources(agentsPath, 'agents');
       const conflicts = detectConflicts(agentsResources, droidsResources);

       if (conflicts.length > 0 && !options.yes) {
         const resolutions = await resolveConflicts(conflicts);

         for (const res of resolutions) {
           if (res.resolution === 'overwrite') {
             await fs.promises.copyFile(res.new, res.existing);
           } else if (res.resolution === 'rename') {
             const newPath = namespaceToPath(res.newName, agentsPath);
             await fs.promises.mkdir(path.dirname(newPath), { recursive: true });
             await fs.promises.copyFile(res.new, newPath);
           }
           // Skip: do nothing
         }
       }

       // Move non-conflicting files
       for (const resource of droidsResources) {
         const srcPath = join(droidsPath, resource.path);
         const destPath = join(agentsPath, resource.path);

         if (!fs.existsSync(destPath)) {
           await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
           await fs.promises.copyFile(srcPath, destPath);
         }
       }

       // Remove droids directory
       await fs.promises.rm(droidsPath, { recursive: true });
       console.log('✅ Merged droids/ into agents/ and removed droids/');

     } else {
       // Rename mode: simple directory rename
       await fs.promises.rename(droidsPath, agentsPath);
       console.log(`✅ Renamed droids/ → agents/`);
     }

     // Verify integrity
     const agentsCount = (await discoverResources(agentsPath, 'agents')).length;
     console.log(`   ${agentsCount} agents migrated successfully`);

     return {
       status: 'success',
       migrated: agentsCount,
       backup: backupPath
     };
   }
   ```

2. **Legacy Path Resolution** (`lib/fs-utils.js` - modify)
   ```javascript
   // lib/fs-utils.js - ENHANCED

   /**
    * Get resource directory with legacy fallback
    */
   function getResourceDir(scope, type) {
     const basePath = scope === 'personal'
       ? expandHome('~/.factory')
       : './.factory';

     const { TYPE_CONFIG } = require('./type-config');
     const config = TYPE_CONFIG[type];

     // Check new path first
     const newPath = join(basePath, type);
     if (fs.existsSync(newPath)) {
       return newPath;
     }

     // Check legacy paths
     if (config.legacyNames && config.legacyNames.length > 0) {
       for (const legacyName of config.legacyNames) {
         const legacyPath = join(basePath, legacyName);
         if (fs.existsSync(legacyPath)) {
           console.warn(
             `⚠️  DEPRECATED: Using legacy "${legacyName}" directory.\n` +
             `   Please rename to "${type}" or run migration:\n` +
             `   droid-factory migrate --droids-to-agents`
           );
           return legacyPath;
         }
       }
     }

     // Return new path even if doesn't exist (for creation)
     return newPath;
   }
   ```

3. **CLI Flag Deprecation** (`lib/args.js` - modify)
   ```javascript
   // lib/args.js - ENHANCED

   function parseArgs(argv) {
     const args = {
       // ... existing args
       agents: undefined,      // NEW: renamed from droids
       droids: undefined,      // DEPRECATED: kept for backward compat
       skills: undefined,      // NEW: skills support
       onlyAgents: false,      // NEW
       onlySkills: false,      // NEW
     };

     // ... existing parsing logic

     // Handle deprecated --droids flag
     if (args.droids !== undefined) {
       console.warn(
         `⚠️  DEPRECATED: The --droids flag has been renamed to --agents.\n` +
         `   Please update your scripts. --droids will be removed in v2.0.0`
       );

       if (args.agents === undefined) {
         args.agents = args.droids;
       }
     }

     return args;
   }
   ```

**Success Criteria:**
- [ ] Migration command creates backup before changes
- [ ] Migration handles both rename and merge modes
- [ ] Conflict resolution during merge works correctly
- [ ] Legacy droids/ directory supported with deprecation warning
- [ ] `--droids` flag works but shows deprecation notice
- [ ] Verification after migration confirms data integrity

**Test Cases:**
```javascript
// test/migration.test.js
test('migrateDroidsToAgents creates backup', async () => {
  await migrateDroidsToAgents('personal');
  const backups = fs.readdirSync('.factory/.backups');
  expect(backups.some(b => b.startsWith('droids-'))).toBe(true);
});

test('migrateDroidsToAgents renames directory', async () => {
  await migrateDroidsToAgents('personal');
  expect(fs.existsSync('.factory/agents')).toBe(true);
  expect(fs.existsSync('.factory/droids')).toBe(false);
});

test('migrateDroidsToAgents handles conflicts in merge mode', async () => {
  // Setup: Create both droids/ and agents/ with overlapping files
  const result = await migrateDroidsToAgents('personal', { merge: true, yes: false });
  // Should prompt for conflict resolution
  expect(result.status).toBe('success');
});

test('getResourceDir returns legacy path with warning', () => {
  const spy = jest.spyOn(console, 'warn');
  const dir = getResourceDir('personal', 'agents');
  expect(dir).toContain('droids'); // Falls back to legacy
  expect(spy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATED'));
});
```

#### Phase 4: UI & User Experience

**Duration:** Sprint 4 (1 week)

**Deliverables:**

1. **Grouped Selection UI** (`lib/ui.js` - modify)
   ```javascript
   // lib/ui.js - ENHANCED

   async function selectResourcesGrouped(resources, type) {
     const { MultiSelect } = require('enquirer');

     // Group by category
     const grouped = {};
     for (const resource of resources) {
       if (!grouped[resource.category]) {
         grouped[resource.category] = [];
       }
       grouped[resource.category].push(resource);
     }

     // Build choices with visual hierarchy
     const choices = [];

     for (const [category, items] of Object.entries(grouped)) {
       if (category !== 'root') {
         // Add category header
         choices.push({
           name: `─── ${category} ───`,
           disabled: true,
           role: 'separator'
         });
       }

       for (const item of items) {
         choices.push({
           name: item.namespace,
           message: category === 'root'
             ? item.name
             : `  ${item.name}`,  // Indent nested items
           hint: item.description || '',
           value: item.namespace
         });
       }
     }

     const selected = await new MultiSelect({
       name: 'resources',
       message: `Select ${type} to install`,
       limit: 15,
       choices: choices,
       result(names) {
         return names; // Return array of namespaces
       },
       format(value) {
         // Show count in footer
         return `${value.length} selected`;
       }
     }).run();

     return selected;
   }
   ```

2. **Breadcrumb Navigation** (`lib/ui.js` - add)
   ```javascript
   // lib/ui.js - NEW

   function renderBreadcrumb(path) {
     const parts = path.split(':');
     const breadcrumb = parts.join(' › ');
     return chalk.dim(breadcrumb);
   }

   async function selectNestedResource(resources, type) {
     const { Select } = require('enquirer');

     let currentPath = [];

     while (true) {
       // Filter resources by current path
       const filtered = resources.filter(r => {
         const parts = r.namespace.split(':');
         return parts.slice(0, currentPath.length).every((p, i) => p === currentPath[i]);
       });

       // Group into categories and items at current level
       const categories = new Set();
       const items = [];

       for (const resource of filtered) {
         const parts = resource.namespace.split(':');
         if (parts.length > currentPath.length + 1) {
           // This is a category
           categories.add(parts[currentPath.length]);
         } else if (parts.length === currentPath.length + 1) {
           // This is an item at current level
           items.push(resource);
         }
       }

       // Build choices
       const choices = [
         ...(currentPath.length > 0 ? [{ name: '.. (back)', value: 'BACK' }] : []),
         ...Array.from(categories).map(cat => ({ name: `📁 ${cat}`, value: `DIR:${cat}` })),
         ...items.map(item => ({
           name: `📄 ${item.name}`,
           value: `ITEM:${item.namespace}`,
           hint: item.description
         }))
       ];

       const header = currentPath.length > 0
         ? `Navigate: ${renderBreadcrumb(currentPath.join(':'))}`
         : `Select ${type}`;

       const choice = await new Select({
         name: 'choice',
         message: header,
         choices: choices
       }).run();

       if (choice === 'BACK') {
         currentPath.pop();
       } else if (choice.startsWith('DIR:')) {
         const dir = choice.replace('DIR:', '');
         currentPath.push(dir);
       } else if (choice.startsWith('ITEM:')) {
         const namespace = choice.replace('ITEM:', '');
         return namespace;
       }
     }
   }
   ```

3. **Tree View Display** (`lib/output.js` - modify)
   ```javascript
   // lib/output.js - ENHANCED

   function renderResourceTree(resources) {
     // Build tree structure
     const tree = {};

     for (const resource of resources) {
       const parts = resource.namespace.split(':');
       let current = tree;

       for (let i = 0; i < parts.length; i++) {
         const part = parts[i];
         if (!current[part]) {
           current[part] = i === parts.length - 1 ? resource : {};
         }
         current = current[part];
       }
     }

     // Render tree
     function renderNode(node, prefix = '', isLast = true) {
       const entries = Object.entries(node);
       const lines = [];

       entries.forEach(([key, value], i) => {
         const isLastEntry = i === entries.length - 1;
         const connector = isLast ? '└── ' : '├── ';
         const extension = isLast ? '    ' : '│   ';

         if (value.namespace) {
           // Leaf node (actual resource)
           lines.push(prefix + connector + chalk.green(key));
         } else {
           // Directory node
           lines.push(prefix + connector + chalk.blue(key + '/'));
           lines.push(...renderNode(value, prefix + extension, isLastEntry));
         }
       });

       return lines;
     }

     return renderNode(tree).join('\n');
   }

   function printSummaryGrouped(results) {
     console.log('\n' + chalk.bold('Installation Summary:'));
     console.log('═'.repeat(50));

     // Group by type
     const byType = {};
     for (const result of results) {
       if (!byType[result.type]) byType[result.type] = [];
       byType[result.type].push(result);
     }

     for (const [type, items] of Object.entries(byType)) {
       console.log(`\n${chalk.bold(type.toUpperCase())}:`);

       const written = items.filter(i => i.status === 'written');
       const skipped = items.filter(i => i.status === 'skipped');

       if (written.length > 0) {
         console.log(chalk.green(`  ✓ ${written.length} installed`));
         for (const item of written) {
           console.log(`    ${item.namespace}`);
         }
       }

       if (skipped.length > 0) {
         console.log(chalk.yellow(`  ⊘ ${skipped.length} skipped`));
       }
     }

     console.log('\n' + '═'.repeat(50));
   }
   ```

**Success Criteria:**
- [ ] Grouped selection shows visual hierarchy with indentation
- [ ] Breadcrumb navigation shows current path
- [ ] Tree view displays nested structure clearly
- [ ] Summary groups results by type and category
- [ ] Color coding improves readability

**Test Cases:**
```javascript
// test/ui.test.js (manual/visual testing)
test('selectResourcesGrouped shows categories', async () => {
  const resources = [
    { name: 'plan', namespace: 'workflows:plan', category: 'workflows' },
    { name: 'review', namespace: 'workflows:review', category: 'workflows' },
    { name: 'security', namespace: 'review:security', category: 'review' }
  ];

  // Visual test: verify output shows category headers
  // Automated test: check choices array structure
  const ui = new GroupedSelectUI(resources);
  const choices = ui.buildChoices();

  expect(choices).toContainEqual(expect.objectContaining({
    name: expect.stringContaining('workflows'),
    disabled: true
  }));
});

test('renderResourceTree builds correct hierarchy', () => {
  const resources = [
    { namespace: 'workflows:plan' },
    { namespace: 'workflows:review' },
    { namespace: 'review:security' }
  ];

  const tree = renderResourceTree(resources);
  expect(tree).toContain('workflows/');
  expect(tree).toContain('  ├── plan');
  expect(tree).toContain('  └── review');
});
```

#### Phase 5: Marketplace Integration

**Duration:** Sprint 5 (1 week)

**Deliverables:**

1. **Skill Conversion** (`lib/skill-convert.js` - new)
   ```javascript
   // lib/skill-convert.js

   const matter = require('gray-matter');
   const { join } = require('path');

   /**
    * Convert Claude skill to Factory skill
    */
   async function convertSkill(sourceDir, targetDir, metadata = {}) {
     // 1. Validate source structure
     const skillMdPath = join(sourceDir, 'SKILL.md');
     if (!fs.existsSync(skillMdPath)) {
       throw new Error(`Missing SKILL.md in ${sourceDir}`);
     }

     // 2. Parse SKILL.md
     const skillContent = fs.readFileSync(skillMdPath, 'utf8');
     const { data: frontmatter, content } = matter(skillContent);

     // 3. Convert frontmatter
     const factoryFrontmatter = {
       name: frontmatter.name || path.basename(targetDir),
       description: sanitizeDescription(frontmatter.description),
       version: frontmatter.version || '1.0.0',
       author: frontmatter.author,
       license: frontmatter.license,
       ...metadata
     };

     // 4. Create target directory
     await fs.promises.mkdir(targetDir, { recursive: true });

     // 5. Write converted SKILL.md
     const factoryContent = matter.stringify(content, factoryFrontmatter);
     await fs.promises.writeFile(
       join(targetDir, 'SKILL.md'),
       factoryContent,
       'utf8'
     );

     // 6. Copy supporting files
     const supportedDirs = ['examples', 'templates', 'docs'];
     for (const dir of supportedDirs) {
       const srcDir = join(sourceDir, dir);
       if (fs.existsSync(srcDir)) {
         const destDir = join(targetDir, dir);
         await fs.promises.cp(srcDir, destDir, {
           recursive: true,
           filter: (src) => {
             // Skip hidden files, executables, archives
             const basename = path.basename(src);
             if (basename.startsWith('.')) return false;
             if (basename.endsWith('.exe') || basename.endsWith('.sh')) return false;
             if (basename.endsWith('.zip') || basename.endsWith('.tar.gz')) return false;
             return true;
           }
         });
       }
     }

     return { path: targetDir, frontmatter: factoryFrontmatter };
   }

   function sanitizeDescription(desc) {
     if (!desc) return '';
     return desc
       .replace(/\n/g, ' ')
       .replace(/:/g, ' -')
       .trim();
   }
   ```

2. **Marketplace Nested Scanning** (`lib/marketplace.js` - modify)
   ```javascript
   // lib/marketplace.js - ENHANCED

   /**
    * Scan plugin with nested structure preservation
    */
   async function scanPluginLocal(pluginPath, overrides = {}) {
     const commandsDir = join(pluginPath, overrides.commands || 'commands');
     const agentsDir = join(pluginPath, overrides.agents || 'agents');
     const skillsDir = join(pluginPath, overrides.skills || 'skills');

     // Discover with nested structure
     const commands = fs.existsSync(commandsDir)
       ? await discoverFileResourcesLocal(commandsDir)
       : [];

     const agents = fs.existsSync(agentsDir)
       ? await discoverFileResourcesLocal(agentsDir)
       : [];

     const skills = fs.existsSync(skillsDir)
       ? await discoverSkillsLocal(skillsDir)
       : [];

     return { commands, agents, skills, errors: [] };
   }

   /**
    * Discover file resources recursively (local)
    */
   async function discoverFileResourcesLocal(baseDir, currentDir = '') {
     const fullPath = join(baseDir, currentDir);
     const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
     const results = [];

     for (const entry of entries) {
       const relativePath = join(currentDir, entry.name);

       if (entry.isDirectory()) {
         // Recurse
         const nested = await discoverFileResourcesLocal(baseDir, relativePath);
         results.push(...nested);
       } else if (entry.name.endsWith('.md')) {
         results.push({
           path: relativePath,
           fullPath: join(fullPath, entry.name),
           namespace: pathToNamespace(relativePath, '', ':').replace('.md', ''),
           isLocal: true
         });
       }
     }

     return results;
   }

   /**
    * Discover skills (local)
    */
   async function discoverSkillsLocal(baseDir, currentDir = '') {
     const fullPath = join(baseDir, currentDir);
     const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
     const results = [];

     for (const entry of entries) {
       if (entry.isDirectory()) {
         const relativePath = join(currentDir, entry.name);
         const skillMdPath = join(fullPath, entry.name, 'SKILL.md');

         if (fs.existsSync(skillMdPath)) {
           // This is a skill directory
           results.push({
             path: relativePath,
             fullPath: join(fullPath, entry.name),
             namespace: pathToNamespace(relativePath, '', ':'),
             isLocal: true,
             isSkill: true
           });
         } else {
           // Recurse into category directories
           const nested = await discoverSkillsLocal(baseDir, relativePath);
           results.push(...nested);
         }
       }
     }

     return results;
   }
   ```

3. **Installation Planner** (`lib/marketplace-planner.js` - modify)
   ```javascript
   // lib/marketplace-planner.js - ENHANCED

   function computeMarketplacePlan(selectedPlugins, destDirs) {
     const plan = { commands: [], agents: [], skills: [] };

     for (const plugin of selectedPlugins) {
       // Process commands (preserve structure)
       for (const cmd of plugin.commands || []) {
         const destPath = join(destDirs.commands, cmd.path);
         plan.commands.push({
           plugin: plugin.name,
           namespace: cmd.namespace,
           src: cmd.isLocal ? cmd.fullPath : cmd.path,
           srcType: cmd.isLocal ? 'local' : 'remote',
           dest: destPath,
           exists: fs.existsSync(destPath)
         });
       }

       // Process agents (preserve structure)
       for (const agent of plugin.agents || []) {
         const destPath = join(destDirs.agents, agent.path);
         plan.agents.push({
           plugin: plugin.name,
           namespace: agent.namespace,
           src: agent.isLocal ? agent.fullPath : agent.path,
           srcType: agent.isLocal ? 'local' : 'remote',
           dest: destPath,
           exists: fs.existsSync(destPath)
         });
       }

       // Process skills (directory-based)
       for (const skill of plugin.skills || []) {
         const destPath = join(destDirs.skills, skill.path);
         plan.skills.push({
           plugin: plugin.name,
           namespace: skill.namespace,
           src: skill.isLocal ? skill.fullPath : skill.path,
           srcType: 'directory',
           dest: destPath,
           exists: fs.existsSync(destPath),
           isSkill: true
         });
       }
     }

     return plan;
   }
   ```

**Success Criteria:**
- [ ] Marketplace scanning discovers nested structures
- [ ] Skill conversion preserves SKILL.md and supporting files
- [ ] Installation planner preserves directory hierarchy
- [ ] Skills installed as complete directories
- [ ] Namespace preservation from source to destination

**Test Cases:**
```javascript
// test/skill-conversion.test.js
test('convertSkill creates SKILL.md with frontmatter', async () => {
  const sourceDir = createTempSkill(); // Helper: creates skill structure
  const targetDir = '/tmp/factory-skill-test';

  await convertSkill(sourceDir, targetDir);

  const skillMd = fs.readFileSync(join(targetDir, 'SKILL.md'), 'utf8');
  const { data } = matter(skillMd);

  expect(data).toHaveProperty('name');
  expect(data).toHaveProperty('description');
});

test('convertSkill copies supporting files', async () => {
  const sourceDir = createTempSkill({
    examples: ['example1.md', 'example2.md']
  });
  const targetDir = '/tmp/factory-skill-test';

  await convertSkill(sourceDir, targetDir);

  expect(fs.existsSync(join(targetDir, 'examples/example1.md'))).toBe(true);
  expect(fs.existsSync(join(targetDir, 'examples/example2.md'))).toBe(true);
});

test('convertSkill skips executables', async () => {
  const sourceDir = createTempSkill({
    examples: ['helper.sh']
  });
  const targetDir = '/tmp/factory-skill-test';

  await convertSkill(sourceDir, targetDir);

  expect(fs.existsSync(join(targetDir, 'examples/helper.sh'))).toBe(false);
});

// test/marketplace-scanning.test.js
test('scanPluginLocal discovers nested commands', async () => {
  const pluginPath = createTempPlugin({
    commands: ['workflows/plan.md', 'workflows/review.md', 'deploy.md']
  });

  const result = await scanPluginLocal(pluginPath);

  expect(result.commands).toContainEqual(
    expect.objectContaining({ namespace: 'workflows:plan' })
  );
  expect(result.commands).toContainEqual(
    expect.objectContaining({ namespace: 'deploy' })
  );
});

test('discoverSkillsLocal finds skill directories', async () => {
  const pluginPath = createTempPlugin({
    skills: ['frontend-design/SKILL.md', 'dhh-ruby-style/SKILL.md']
  });

  const result = await discoverSkillsLocal(join(pluginPath, 'skills'));

  expect(result).toHaveLength(2);
  expect(result[0].isSkill).toBe(true);
});
```

## Alternative Approaches Considered

### Alternative 1: Slash Separator (`/`)

**Pros:**
- Intuitive (matches filesystem paths)
- Familiar to users

**Cons:**
- Conflicts with CLI argument parsing (path ambiguity)
- Shell escaping issues on some platforms
- Less distinctive from actual file paths

**Decision:** Rejected in favor of colon (`:`) for clarity and compatibility with EveryInc/every-marketplace.

### Alternative 2: Dot Separator (`.`)

**Pros:**
- Module-like syntax (`workflows.plan`)
- No escaping needed in shells

**Cons:**
- Conflicts with file extensions
- Could be confused with npm package naming
- Not used by reference implementation (EveryInc)

**Decision:** Rejected in favor of colon (`:`) to match EveryInc pattern.

### Alternative 3: Unlimited Nesting Depth

**Pros:**
- Maximum flexibility
- No artificial constraints

**Cons:**
- UX degradation with deep hierarchies (UX best practice: max 2 levels per oclif)
- Complex CLI argument parsing
- Filesystem path length limits on some systems

**Decision:** Limited to 2 levels for usability and simplicity.

### Alternative 4: Keep "droids" Terminology

**Pros:**
- No migration needed
- No breaking changes

**Cons:**
- Terminology mismatch with Factory (uses "agents")
- Confusion for new users
- Misses opportunity for alignment

**Decision:** Rename to "agents" with migration path for backward compatibility.

### Alternative 5: Skills as Single Files (Like Commands/Agents)

**Pros:**
- Consistent file structure across all types
- Simpler discovery logic

**Cons:**
- Cannot include supporting files (examples, templates)
- Doesn't match EveryInc/every-marketplace pattern
- Less flexible for complex skills

**Decision:** Use directory-based structure for skills to support rich content.

## Acceptance Criteria

### Functional Requirements

#### Discovery & Resolution
- [ ] Flat commands/agents at root level are discovered
- [ ] Nested commands/agents in subdirectories are discovered with namespaces
- [ ] Skills directories containing SKILL.md are discovered
- [ ] Resolution finds resources via: root level, nested namespace, auto-discovery
- [ ] Priority order enforced: root > nested > autodiscovery
- [ ] Name conflicts detected and reported

#### Installation
- [ ] Flat resources install to root directory
- [ ] Nested resources install preserving directory structure
- [ ] Skills install as complete directories with supporting files
- [ ] Conflict resolution UI prompts for user choice
- [ ] Parent directories created automatically
- [ ] Installation status tracked (written, skipped, failed)

#### Migration
- [ ] `droid-factory migrate --droids-to-agents` renames directory
- [ ] Backup created before migration
- [ ] Merge mode handles overlapping files
- [ ] Data integrity verified after migration
- [ ] Legacy `droids/` directory supported with deprecation warning

#### CLI
- [ ] `--commands workflows:plan` resolves nested command
- [ ] `--agents review:security` resolves nested agent
- [ ] `--skills all` installs all skills
- [ ] `--droids` flag works but shows deprecation notice
- [ ] Conflicting flags show clear error messages
- [ ] Help text updated with nested examples

#### UI
- [ ] Grouped selection shows category headers
- [ ] Nested items visually indented
- [ ] Breadcrumb navigation shows current path
- [ ] Tree view displays hierarchy clearly
- [ ] Summary groups results by type and category

#### Marketplace
- [ ] Marketplace plugins with nested structures preserved
- [ ] Skill directories copied completely
- [ ] Namespace conflicts during installation detected
- [ ] EveryInc/every-marketplace plugin installs correctly

### Non-Functional Requirements

#### Performance
- [ ] Discovery completes in <1s for 100 resources
- [ ] Installation of 50 nested items completes in <5s
- [ ] Memory usage stays under 100MB during operations

#### Security
- [ ] Path traversal attempts rejected (e.g., `../../etc/passwd`)
- [ ] Executables in skills directories blocked
- [ ] Symlinks handled safely (not followed by default)

#### Accessibility
- [ ] Color coding has sufficient contrast
- [ ] Tree view readable in monochrome terminals
- [ ] Error messages clear and actionable
- [ ] Progress indicators work in non-interactive mode

### Quality Gates

#### Test Coverage
- [ ] Unit tests: >80% coverage
- [ ] Integration tests: All user flows tested
- [ ] Migration tests: All scenarios tested
- [ ] Manual testing: Visual UI verified

#### Documentation
- [ ] README updated with nested structure examples
- [ ] Migration guide published
- [ ] CLI help text updated
- [ ] API documentation for new functions

#### Code Review
- [ ] All code reviewed by 2+ engineers
- [ ] Security review for path handling
- [ ] Performance profiling for discovery/installation
- [ ] UX review for interactive prompts

## Success Metrics

### Quantitative
- **Installation Success Rate:** >95% of marketplace plugins install without errors
- **Migration Success Rate:** >99% of migrations complete without data loss
- **Discovery Performance:** <100ms for typical installations (<50 resources)
- **User Errors:** <5% of installations require conflict resolution

### Qualitative
- **Developer Satisfaction:** Positive feedback on nested organization clarity
- **Marketplace Adoption:** EveryInc/every-marketplace plugin works out-of-box
- **Migration Ease:** Users report smooth droids→agents transition
- **Discoverability:** Users find specific resources faster in grouped UI

## Dependencies & Prerequisites

### Internal Dependencies
- `lib/fs-utils.js` - File system operations
- `lib/cli.js` - CLI orchestration
- `lib/args.js` - Argument parsing
- `lib/ui.js` - Interactive prompts
- `lib/marketplace.js` - Marketplace integration
- `lib/planner.js` - Installation planning
- `package.json` - Node.js version requirement (>=16.7.0 for fs.cp)

### External Dependencies

**Current:**
- `enquirer@^2.3.6` - Interactive prompts
- `gray-matter@^4.0.3` - YAML frontmatter parsing

**New (Recommended):**
- `ajv@^8.12.0` - JSON Schema validation for frontmatter

**Optional (Future):**
- `ora@^5.4.1` - Enhanced spinners (use v5 for CommonJS)
- `cli-progress@^3.12.0` - Progress bars

### System Requirements
- Node.js >=16.7.0 (for `fs.cp()` with `recursive: true`)
- ~/.factory/ directory writable
- GitHub API access (for marketplace installations)

### Prerequisite Tasks
- [ ] Existing `.factory/droids/` migrated or acknowledged
- [ ] Factory settings: `enableCustomDroids: true`
- [ ] Write permissions for target directories

## Risk Analysis & Mitigation

### High-Priority Risks

#### Risk 1: Data Loss During Migration
**Impact:** Critical - users lose custom agents
**Probability:** Medium

**Mitigation:**
- Always create backup before migration
- Verify backup integrity before proceeding
- Show backup location to user
- Provide rollback command
- Test migration with large datasets

#### Risk 2: Path Traversal Vulnerability
**Impact:** Critical - security breach
**Probability:** Low (if properly validated)

**Mitigation:**
- Validate all namespaces against whitelist regex
- Use `path.resolve()` and check against base directory
- Reject any paths with `..` or absolute paths
- Security audit of path handling code
- Automated security tests in CI

#### Risk 3: Namespace Conflicts Breaking Existing Workflows
**Impact:** High - users' installations fail
**Probability:** Medium

**Mitigation:**
- Detect conflicts before writing files
- Interactive conflict resolution UI
- Clear error messages with resolution options
- Document conflict resolution in migration guide
- Test with real-world marketplace plugins

### Medium-Priority Risks

#### Risk 4: Performance Degradation with Large Structures
**Impact:** Medium - slow installations
**Probability:** Medium

**Mitigation:**
- Implement discovery caching
- Use async I/O for file operations
- Profile with large test datasets
- Add progress indicators for long operations
- Document performance characteristics

#### Risk 5: Marketplace Compatibility Issues
**Impact:** Medium - some plugins don't install
**Probability:** Low

**Mitigation:**
- Test with EveryInc/every-marketplace early
- Handle malformed manifests gracefully
- Provide clear error messages
- Document required manifest format
- Validate manifests during installation

#### Risk 6: UI Complexity Confusing Users
**Impact:** Medium - poor UX
**Probability:** Low

**Mitigation:**
- Conduct user testing with nested structures
- Provide simple flat mode for basic users
- Add examples to help text
- Keep interactive prompts clear and concise
- Provide `--help` with nested examples

### Low-Priority Risks

#### Risk 7: Cross-Platform Path Issues
**Impact:** Low - works on some platforms, not others
**Probability:** Low

**Mitigation:**
- Use Node.js `path` module for all path operations
- Test on Windows, macOS, Linux
- Handle platform-specific path separators
- Document platform-specific behaviors

#### Risk 8: Symlink Handling Edge Cases
**Impact:** Low - some installations incomplete
**Probability:** Low

**Mitigation:**
- Detect symlinks via `fs.lstat()`
- Document symlink handling policy (not followed)
- Warn users if symlinks detected
- Test with symlinked directories

## Resource Requirements

### Development Team
- **2 Senior Engineers** - Core implementation (Phases 1-3)
- **1 Mid-Level Engineer** - UI/UX implementation (Phase 4)
- **1 Senior Engineer** - Marketplace integration (Phase 5)
- **1 QA Engineer** - Testing throughout all phases

### Time Estimate
- **Phase 1:** 2 weeks (Foundation)
- **Phase 2:** 2 weeks (Resolution & Installation)
- **Phase 3:** 1 week (Migration)
- **Phase 4:** 1 week (UI/UX)
- **Phase 5:** 1 week (Marketplace)
- **Testing & QA:** 1 week (parallel with phases 4-5)
- **Total:** 7 weeks (Sprint 1-5 + QA)

### Infrastructure
- CI/CD pipeline updates for new tests
- Test fixtures for nested structures
- Marketplace test plugins
- Performance benchmarking environment

## Future Considerations

### Version 1.1 Enhancements
- **Discovery caching** - Persistent cache with invalidation
- **Skill versioning** - Install specific skill versions
- **Programmatic API** - Query installed resources via JSON export
- **Search** - Fuzzy search across nested structures
- **Filters** - `--filter category` to install by category

### Version 2.0 Breaking Changes
- **Remove droids/ support** - Complete migration to agents/
- **Remove --droids flag** - Force use of --agents
- **Deprecation cleanup** - Remove all legacy code paths

### Long-Term Vision
- **Plugin marketplace UI** - Web interface for browsing plugins
- **Dependency resolution** - Skills depend on other skills
- **Auto-updates** - Check for plugin updates
- **Signed plugins** - Cryptographic verification
- **Sandboxing** - Run skills in isolated environments

## Documentation Plan

### User Documentation

#### README.md Updates
- [ ] Add "Nested Organization" section
- [ ] Update examples with namespace syntax
- [ ] Document three resource types
- [ ] Add migration guide link
- [ ] Update CLI flags documentation

**Example Section:**
```markdown
## Nested Organization

Organize your commands, agents, and skills using subdirectories:

```
.factory/
├── commands/
│   └── workflows/
│       ├── plan.md      # /workflows:plan
│       └── review.md    # /workflows:review
└── agents/
    └── review/
        └── security.md  # subagent_type: 'review:security'
```

Invoke with colon separator:
- `/workflows:plan`
- `droid-factory --commands workflows:plan,workflows:review`
```

#### Migration Guide (New Document)
- [ ] Why migrate from droids to agents
- [ ] Step-by-step migration instructions
- [ ] Automated vs manual migration
- [ ] Conflict resolution examples
- [ ] Rollback procedure
- [ ] FAQ

#### CLI Reference
- [ ] Update `--help` text
- [ ] Add nested examples to each flag
- [ ] Document namespace syntax rules
- [ ] Explain conflict resolution options

### Developer Documentation

#### Architecture Document
- [ ] Component diagram (discovery, resolution, installation)
- [ ] Data flow diagrams
- [ ] Namespace resolution algorithm
- [ ] Type system (file vs directory resources)

#### API Reference
- [ ] New functions in `lib/namespace.js`
- [ ] Updated functions in `lib/fs-utils.js`
- [ ] Migration functions in `lib/migration.js`
- [ ] Skill conversion in `lib/skill-convert.js`

#### Plugin Author Guide
- [ ] How to structure nested plugins
- [ ] Manifest format with nested paths
- [ ] Skill directory requirements
- [ ] Testing nested installations
- [ ] Examples from EveryInc/every-marketplace

## References & Research

### Internal References

**Architecture & Implementation:**
- `/home/tommyk/projects/ai/agents/droid-factory/lib/cli.js:89-128` - Current guided flow state machine
- `/home/tommyk/projects/ai/agents/droid-factory/lib/fs-utils.js:8-14` - Flat directory discovery (`listBasenames`)
- `/home/tommyk/projects/ai/agents/droid-factory/lib/planner.js:24-50` - Current installation planning
- `/home/tommyk/projects/ai/agents/droid-factory/lib/marketplace.js:349-375` - Local plugin scanning
- `/home/tommyk/projects/ai/agents/droid-factory/lib/marketplace-planner.js:40-53` - Marketplace installation planner

**Templates & Patterns:**
- `/home/tommyk/projects/ai/agents/droid-factory/templates/commands/code-review.md:9-16` - Command invocation pattern
- `/home/tommyk/projects/ai/agents/droid-factory/templates/droids/` - Current agent templates (10 files)

**Configuration:**
- `/home/tommyk/projects/ai/agents/droid-factory/package.json` - Node.js version requirement (>=16)
- `/home/tommyk/projects/ai/agents/droid-factory/.github/workflows/` - CI/CD automation

### External References

**CLI Framework Best Practices:**
- [oclif Topics Documentation](https://oclif.io/docs/topics/) - Nested command patterns, 1-2 level depth recommendation
- [Heroku CLI GitHub](https://github.com/heroku/cli) - Real-world oclif implementation
- [Building a CLI Application with oclif (Salesforce)](https://developer.salesforce.com/blogs/2022/10/building-a-cli-application-with-oclif)
- [Commander.js GitHub](https://github.com/tj/commander.js) - Subcommand patterns
- [Yargs GitHub](https://github.com/yargs/yargs) - Nested command directory loading

**Plugin System Architectures:**
- [npm package.json Documentation](https://docs.npmjs.com/cli/v7/configuring-npm/package.json/) - Package discovery
- [webpack Tapable GitHub](https://github.com/webpack/tapable) - Event-driven hooks
- [VS Code Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest) - Manifest-based discovery
- [ESLint Shareable Configs](https://eslint.org/docs/latest/extend/shareable-configs) - Configuration cascade
- [Babel Configuration](https://babeljs.io/docs/configuration) - Priority resolution

**Directory Migration:**
- [Node.js Deprecated APIs](https://nodejs.org/api/deprecations.html) - Deprecation best practices
- [Playwright CLI Deprecation Notice](https://deepwiki.com/microsoft/playwright-cli/3.1-deprecation-notice-and-migration-guide) - Excellent deprecation example
- [Migrating from Node.js 20 to 22](https://markaicode.com/nodejs-20-to-22-migration-and-automated-upgrade/) - Migration patterns

**Node.js APIs:**
- [Node.js File System Documentation](https://nodejs.org/api/fs.html) - `fs.cp()`, `fs.readdir()`, `fs.watch()`
- [Node.js Path Module](https://github.com/nodejs/node/blob/main/doc/api/path.md) - Cross-platform path handling
- [Node.js URL Module](https://github.com/nodejs/node/blob/main/doc/api/url.md) - File URL conversion

**Validation & Schema:**
- [AJV JSON Schema Validator](https://www.npmjs.com/package/ajv) - Frontmatter validation
- [YAML Schema Validation](https://json-schema-everywhere.github.io/yaml) - YAML schemas
- [Stack Overflow: YAML Schema Validation](https://stackoverflow.com/questions/5060086/yaml-schema-validation)

**UI & Progress:**
- [Enquirer Documentation](https://github.com/enquirer/enquirer) - Interactive prompts
- [Enquirer MultiSelect Prompt](https://github.com/enquirer/enquirer/blob/master/docs/prompts/multiselect.md)
- [ora on npm](https://www.npmjs.com/package/ora) - Terminal spinners
- [ora GitHub Repository](https://github.com/sindresorhus/ora)

**Best Practices:**
- [Node.js CLI Apps Best Practices](https://github.com/lirantal/nodejs-cli-apps-best-practices)
- [Mastering Node.js CLI Best Practices](https://dev.to/boudydegeer/mastering-nodejs-cli-best-practices-and-tips-7j5)

### Related Work

**Reference Implementation:**
- [EveryInc/every-marketplace](https://github.com/EveryInc/every-marketplace) - Plugin structure pattern
- `plugins/compounding-engineering/` - 17 agents, 6 commands, 11 skills
- `commands/workflows/plan.md` - Nested command example
- `agents/review/kieran-rails-reviewer.md` - Nested agent example
- `skills/frontend-design/SKILL.md` - Skill directory structure

**Similar Projects:**
- Heroku CLI - Topic-based nested commands
- VS Code Extensions - Directory-based plugins
- ESLint Shareable Configs - Hierarchical configuration

## Appendix: Technical Specifications

### Namespace Grammar (EBNF)

```ebnf
namespace     ::= segment (":" segment)?
segment       ::= alphanum (alphanum | "-" | "_")*
alphanum      ::= [a-zA-Z0-9]
```

**Rules:**
- Max 2 segments (depth limit)
- Segments: alphanumeric + hyphens + underscores only
- No leading/trailing hyphens
- No consecutive colons
- Case-insensitive matching

### File Structure Schemas

#### SKILL.md Frontmatter Schema (JSON Schema)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z0-9_-]+$",
      "description": "Skill identifier"
    },
    "description": {
      "type": "string",
      "maxLength": 200,
      "description": "Short description"
    },
    "version": {
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$",
      "description": "Semantic version"
    },
    "author": {
      "type": "string",
      "description": "Author name or organization"
    },
    "license": {
      "type": "string",
      "description": "License identifier"
    }
  },
  "required": ["name", "description"],
  "additionalProperties": true
}
```

#### Marketplace Plugin Manifest Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "plugins": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "description": { "type": "string" },
          "version": { "type": "string" },
          "commands": { "type": "string" },
          "agents": { "type": "string" },
          "skills": { "type": "string" }
        },
        "required": ["name"]
      }
    }
  },
  "required": ["plugins"]
}
```

### Error Codes

| Code | Name | Description |
|------|------|-------------|
| `ERR_INVALID_NAMESPACE` | InvalidNamespace | Namespace contains forbidden characters |
| `ERR_NAMESPACE_DEPTH` | NamespaceDepth | Namespace exceeds maximum depth (2) |
| `ERR_NAMESPACE_CONFLICT` | NamespaceConflict | Namespace already exists |
| `ERR_PATH_TRAVERSAL` | PathTraversal | Path attempts directory traversal |
| `ERR_MISSING_SKILL_MD` | MissingSkillMd | Skill directory lacks SKILL.md |
| `ERR_MIGRATION_CONFLICT` | MigrationConflict | Both droids/ and agents/ exist |
| `ERR_INVALID_FRONTMATTER` | InvalidFrontmatter | YAML frontmatter validation failed |
| `ERR_FORBIDDEN_FILE_TYPE` | ForbiddenFileType | Executable or archive in skill directory |

### Performance Benchmarks

**Target Performance (Node.js 16, MacBook Pro M1):**

| Operation | Resources | Target Time |
|-----------|-----------|-------------|
| Discovery (flat) | 50 | <50ms |
| Discovery (nested) | 50 | <100ms |
| Discovery (skills) | 20 | <150ms |
| Installation (commands) | 10 | <500ms |
| Installation (skills with files) | 5 | <2s |
| Migration (droids→agents) | 30 | <1s |
| Conflict resolution UI | N/A | <100ms per prompt |

---

## MVP: Minimum Viable Plan

For initial implementation, focus on **Phases 1-3** only:

### Phase 1: Foundation (2 weeks)
- Namespace utilities (`lib/namespace.js`)
- Type configuration (`lib/type-config.js`)
- Enhanced discovery (`lib/fs-utils.js`)

### Phase 2: Resolution & Installation (2 weeks)
- Resolution logic (`lib/planner.js`)
- Conflict detection (`lib/conflict-detector.js`)
- Installation with structure preservation (`lib/cli.js`)

### Phase 3: Migration (1 week)
- Migration command (`lib/migration.js`)
- Legacy path resolution (`lib/fs-utils.js`)
- CLI flag deprecation (`lib/args.js`)

**Defer to future releases:**
- Phase 4: UI enhancements (grouped selection, breadcrumbs, tree view)
- Phase 5: Marketplace integration (skill conversion, nested scanning)

This gets core functionality shipped in **5 weeks** instead of 7, with polished UX following in v1.1.

---

**Plan Version:** 1.0
**Created:** 2025-01-26
**Author:** Research Agents (repo-research-analyst, best-practices-researcher, framework-docs-researcher, spec-flow-analyzer)
**Status:** Draft - Awaiting Review
