#!/usr/bin/env node
"use strict";

/**
 * Droid Factory installer
 * Installs Markdown commands and custom droids into ~/.factory by default.
 * Supports interactive confirmation with a braille spinner while copying files.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const BRAILLE_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

function canPrompt() {
  return process.stdin.isTTY && process.stdout.isTTY;
}

function getTemplateDescription(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.startsWith('---')) return null;
    const end = content.indexOf('\n---', 3);
    if (end === -1) return null;
    const frontMatter = content.slice(3, end).split('\n');
    for (const rawLine of frontMatter) {
      const line = rawLine.trim();
      if (line.toLowerCase().startsWith('description:')) {
        const value = line.slice('description:'.length).trim();
        return value.replace(/^['"]|['"]$/g, '');
      }
    }
  } catch (err) {
    // Ignore parse errors; fallback to null description
  }
  return null;
}

function readCustomDroidsSetting() {
  const settingsPath = path.join(os.homedir(), '.factory', 'settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    // Factory settings may contain leading comments. Strip // and /* */ style comments.
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\n)\s*\/\/.*?(?=\n|$)/g, '$1');
    const data = JSON.parse(stripped);
    return { enabled: data?.enableCustomDroids === true, path: settingsPath };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { enabled: false, missing: true, path: settingsPath };
    }
    return { enabled: false, error: err, path: settingsPath };
  }
}

function parseArgs(argv) {
  const args = {
    scope: 'personal',
    path: '',
    force: false,
    verbose: false,
    help: false,
    yes: false,
    dryRun: false,
    noSpinner: false,
    noCommands: false,
    noDroids: false,
    onlyCommands: false,
    onlyDroids: false,
    commands: undefined,
    droids: undefined,
    list: false
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scope' && i + 1 < argv.length) { args.scope = argv[++i]; }
    else if (a === '--path' && i + 1 < argv.length) { args.path = argv[++i]; }
    else if (a === '--force') { args.force = true; }
    else if (a === '--yes' || a === '-y') { args.yes = true; }
    else if (a === '--dry-run') { args.dryRun = true; }
    else if (a === '--no-spinner') { args.noSpinner = true; }
    else if (a === '--no-commands') { args.noCommands = true; }
    else if (a === '--no-droids') { args.noDroids = true; }
    else if (a === '--only-commands') { args.onlyCommands = true; }
    else if (a === '--only-droids') { args.onlyDroids = true; }
    else if (a === '--commands' && i + 1 < argv.length) { args.commands = argv[++i]; }
    else if (a === '--droids' && i + 1 < argv.length) { args.droids = argv[++i]; }
    else if (a === '--list') { args.list = true; }
    else if (a === '--verbose') { args.verbose = true; }
    else if (a === '-h' || a === '--help') { args.help = true; }
    else {
      // ignore unknown arguments for forward compatibility
    }
  }
  return args;
}

function usage() {
  const invoked = path.basename(process.argv[1] || 'droid-factory');
  console.log(`\nUsage: ${invoked} [options]\n\nTargets:\n  --scope personal|project        Install to ~/.factory (default) or <repo>/.factory\n  --path <repo-root>              Required when --scope=project\n\nSelection (defaults: commands=all, droids=all):\n  --commands all|name1,name2      Install all or specific commands\n  --droids all|name1,name2        Install all or specific droids\n  --no-commands                   Skip installing commands\n  --no-droids                     Skip installing droids\n  --only-commands                 Commands only (implies --no-droids)\n  --only-droids                   Droids only (implies --no-commands)\n  --list                          List available templates then exit\n\nOther:\n  --force                         Overwrite existing files\n  --yes, -y                      Skip confirmation prompt\n  --dry-run                      Show plan only (no writes)\n  --no-spinner                   Disable animated spinner\n  --verbose                       Verbose logging\n  -h, --help                      Show this help\n\nNotes:\n- Names refer to template basenames (e.g. code-review, security-code-reviewer).\n- Defaults install to personal scope → ~/.factory/{commands,droids}.\n- When --scope=project, pass --path pointing at the repo root.\n`);
}

function listBasenames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

function resolveSelection(request, available, kind) {
  if (!request) return null; // caller will use defaults
  if (request === 'all') return [...available];
  const wanted = request.split(',').map((s) => s.trim()).filter(Boolean);
  const result = [];
  const missing = [];
  for (const name of wanted) {
    const normalized = name.replace(/\.md$/, '');
    if (available.includes(normalized)) result.push(normalized);
    else missing.push(name);
  }
  if (missing.length) {
    console.warn(`Warning: Unknown ${kind} template(s): ${missing.join(', ')}`);
  }
  return result;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest, force) {
  if (fs.existsSync(dest) && !force) {
    return 'skipped';
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return 'written';
}

function printInstalled(plan, copyResults) {
  if (plan.commands.length) {
    console.log('\nCommands installed:');
    plan.commands.forEach((item) => {
      const result = copyResults.commands.get(item.name);
      let status = '';
      if (result === 'written' && !item.exists) status = ' (new)';
      else if (result === 'written' && item.exists) status = ' (overwritten)';
      else if (item.exists || result === 'skipped') status = ' (exists)';
      const description = item.description ? ` — ${item.description}` : '';
      console.log(`  /${item.name}${status}${description}`);
    });
  }

  if (plan.droids.length) {
    console.log('\nDroids installed:');
    plan.droids.forEach((item) => {
      const result = copyResults.droids.get(item.name);
      let status = '';
      if (result === 'written' && !item.exists) status = ' (new)';
      else if (result === 'written' && item.exists) status = ' (overwritten)';
      else if (item.exists || result === 'skipped') status = ' (exists)';
      const description = item.description ? ` — ${item.description}` : '';
      console.log(`  ${item.name}${status}${description}`);
    });
  }
}

function printPlan(plan, args, destCommands, destDroids) {
  console.log('Install plan:');
  if (!args.noCommands) {
    console.log('  Commands:');
    if (!plan.commands.length) console.log('    (none)');
    else for (const item of plan.commands) console.log(`    - ${item.name}${item.exists ? ' (exists)' : ''}`);
  }
  if (!args.noDroids) {
    console.log('  Droids:');
    if (!plan.droids.length) console.log('    (none)');
    else for (const item of plan.droids) console.log(`    - ${item.name}${item.exists ? ' (exists)' : ''}`);
  }
  console.log('\nInstalling to:');
  if (!args.noCommands) console.log(`  ${destCommands}`);
  if (!args.noDroids) console.log(`  ${destDroids}`);
  const existsCount = plan.commands.filter((c) => c.exists).length + plan.droids.filter((d) => d.exists).length;
  const newCount = plan.commands.length + plan.droids.length - existsCount;
  console.log(`\nSummary: ${newCount} new, ${existsCount} existing${existsCount && !args.force ? ' (will skip unless --force)' : ''}`);
}

function startSpinner(enabled, label) {
  if (!enabled || !process.stdout.isTTY) return null;
  let frame = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r${BRAILLE_FRAMES[frame = (frame + 1) % BRAILLE_FRAMES.length]} ${label}`);
  }, 80);
  return timer;
}

function stopSpinner(timer) {
  if (timer) {
    clearInterval(timer);
    if (process.stdout.isTTY) process.stdout.write('\r');
  }
}

async function confirmIfNeeded(args) {
  const interactive = canPrompt() && !args.yes && !args.dryRun;
  if (!interactive) return args; // unchanged

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question('\nProceed? [y] Yes / [f] Force overwrite / [n] Cancel: ', resolve);
  });
  rl.close();

  const normalized = (answer || '').trim().toLowerCase();
  if (normalized === 'n' || normalized === 'no') {
    console.log('Cancelled.');
    process.exit(0);
  }
  if (normalized === 'f' || normalized === 'force') {
    return { ...args, force: true };
  }
  return args;
}

async function promptYesNo(question, defaultValue = false) {
  if (!canPrompt()) return defaultValue;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(question, resolve);
  });
  rl.close();

  const normalized = (answer || '').trim().toLowerCase();
  if (normalized === 'y' || normalized === 'yes') return true;
  if (normalized === 'n' || normalized === 'no') return false;
  return defaultValue;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  const templateDir = path.join(__dirname, '..', 'templates');
  const templateCommands = path.join(templateDir, 'commands');
  const templateDroids = path.join(templateDir, 'droids');

  const availableCommands = listBasenames(templateCommands);
  const availableDroids = listBasenames(templateDroids);

  if (args.list) {
    console.log('Available command templates:');
    console.log(availableCommands.length ? '  - ' + availableCommands.join('\n  - ') : '  (none)');
    console.log('\nAvailable droid templates:');
    console.log(availableDroids.length ? '  - ' + availableDroids.join('\n  - ') : '  (none)');
    return;
  }

  if (args.onlyCommands) args.noDroids = true;
  if (args.onlyDroids) args.noCommands = true;

  let baseDir = '';
  if (args.scope === 'personal' || !args.scope) {
    baseDir = path.join(os.homedir(), '.factory');
  } else if (args.scope === 'project') {
    if (!args.path) {
      console.error('Error: --scope=project requires --path <repo-root>');
      process.exit(2);
    }
    baseDir = path.join(path.resolve(args.path), '.factory');
  } else {
    console.error(`Error: unknown --scope '${args.scope}'. Use 'personal' or 'project'.`);
    process.exit(2);
  }

  const destCommands = path.join(baseDir, 'commands');
  const destDroids = path.join(baseDir, 'droids');

  const selectedCommands = args.noCommands
    ? []
    : (resolveSelection(args.commands, availableCommands, 'command') || [...availableCommands]);

  const selectedDroids = args.noDroids
    ? []
    : (resolveSelection(args.droids, availableDroids, 'droid') || [...availableDroids]);

  if (!selectedCommands.length && !selectedDroids.length) {
    console.log('Nothing to install (no commands or droids selected).');
    return;
  }

  const plan = {
    commands: selectedCommands.map((name) => {
      const src = path.join(templateCommands, `${name}.md`);
      const dest = path.join(destCommands, `${name}.md`);
      return {
        name,
        src,
        dest,
        description: getTemplateDescription(src),
        exists: fs.existsSync(dest)
      };
    }),
    droids: selectedDroids.map((name) => {
      const src = path.join(templateDroids, `${name}.md`);
      const dest = path.join(destDroids, `${name}.md`);
      return {
        name,
        src,
        dest,
        description: getTemplateDescription(src),
        exists: fs.existsSync(dest)
      };
    })
  };

  printPlan(plan, args, destCommands, destDroids);

  const customDroidsStatus = readCustomDroidsSetting();
  if (customDroidsStatus.missing) {
    console.log('\nCustom droids setting: not found');
    console.log(`  Create ${customDroidsStatus.path} and set "enableCustomDroids": true, or toggle Custom Droids via the /settings command.`);
  } else if (customDroidsStatus.enabled) {
    console.log('\nCustom droids setting: ENABLED');
  } else if (customDroidsStatus.error) {
    console.log('\nCustom droids setting: unreadable (see details below)');
    console.log(`  ${customDroidsStatus.error.message}`);
    console.log('  Toggle Custom Droids via the /settings command to regenerate the file.');
  } else {
    console.log('\nCustom droids setting: DISABLED');
    console.log('  Enable Custom Droids via the /settings command or set "enableCustomDroids": true in ~/.factory/settings.json.');
  }

  if (args.dryRun) {
    console.log('\nDry run: no files were written.');
    return;
  }

  const confirmedArgs = await confirmIfNeeded(args);

  if (!confirmedArgs.noCommands) ensureDir(destCommands);
  if (!confirmedArgs.noDroids) ensureDir(destDroids);

  const canSpin = !confirmedArgs.noSpinner && process.stdout.isTTY;
  let spinnerTimer = startSpinner(canSpin, 'Installing...');

  const logWithSpinnerReset = (message) => {
    if (spinnerTimer) {
      stopSpinner(spinnerTimer);
      spinnerTimer = null;
    }
    console.log(message);
    if (canSpin) spinnerTimer = startSpinner(true, 'Installing...');
  };

  const copyResults = { commands: new Map(), droids: new Map() };

  try {
    if (!confirmedArgs.noCommands) {
      for (const item of plan.commands) {
        if (!fs.existsSync(item.src)) {
          logWithSpinnerReset(`skip   ${item.name} (template not found)`);
          continue;
        }
        const result = copyFile(item.src, item.dest, confirmedArgs.force);
        copyResults.commands.set(item.name, result);
        if (confirmedArgs.verbose) {
          const label = result === 'skipped' ? 'skip   ' : 'wrote  ';
          logWithSpinnerReset(`${label}${item.dest}`);
        }
      }
    }

    if (!confirmedArgs.noDroids) {
      for (const item of plan.droids) {
        if (!fs.existsSync(item.src)) {
          logWithSpinnerReset(`skip   ${item.name} (template not found)`);
          continue;
        }
        const result = copyFile(item.src, item.dest, confirmedArgs.force);
        copyResults.droids.set(item.name, result);
        if (confirmedArgs.verbose) {
          const label = result === 'skipped' ? 'skip   ' : 'wrote  ';
          logWithSpinnerReset(`${label}${item.dest}`);
        }
      }
    }
  } finally {
    stopSpinner(spinnerTimer);
  }

  console.log('\nDone. In Factory CLI:');
  console.log('- Restart Droid (Ctrl+C, then relaunch) or run /commands and press R to reload.');

  const interactive = canPrompt();
  let showDetails = confirmedArgs.verbose;
  if (!showDetails && interactive) {
    showDetails = await promptYesNo('\nShow installed commands and droids? [y/N]: ', false);
  }

  if (showDetails) {
    printInstalled(plan, copyResults);
  } else if (!interactive && !confirmedArgs.verbose && (plan.commands.length || plan.droids.length)) {
    console.log('\nHint: rerun with --verbose to list installed commands and droids.');
  }
}

main().catch((err) => {
  console.error('Installation failed:', err?.message || err);
  process.exit(1);
});
