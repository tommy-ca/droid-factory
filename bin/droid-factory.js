#!/usr/bin/env node
"use strict";

/**
 * Droid Factory installer
 * Installs Markdown commands and custom droids into ~/.factory by default.
 * Uses an ASCII slash spinner during installation for a clean TUI.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
let Select, MultiSelect, Confirm;

const SYM_CHECK = '*';
const SYM_ARROW = '>';
const SPIN_FRAMES = ['/', '-', '\\', '|'];

function dim(str) {
  return `\x1b[2m${str}\x1b[0m`;
}

function green(str) { return `\x1b[32m${str}\x1b[0m`; }
function cyan(str) { return `\x1b[36m${str}\x1b[0m`; }
function bold(str) { return `\x1b[1m${str}\x1b[0m`; }

function plural(n, one, many) {
  return n === 1 ? one : (many || one + 's');
}

function termWidth() {
  return (process.stdout && process.stdout.columns) ? process.stdout.columns : 80;
}

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, Math.max(0, max - 1)) + '…';
}

function startSlashSpinner(label) {
  if (!process.stdout.isTTY) return null;
  let frame = 0;
  const timer = setInterval(() => {
    const glyph = SPIN_FRAMES[frame = (frame + 1) % SPIN_FRAMES.length];
    process.stdout.write(`\r${glyph} ${label}`);
  }, 80);
  return timer;
}

function stopSlashSpinner(timer) {
  if (!timer) return;
  clearInterval(timer);
  if (process.stdout.isTTY) process.stdout.write('\r');
}

function canPrompt() {
  return process.stdin.isTTY && process.stdout.isTTY;
}

// Ensure Ctrl+C exits cleanly anywhere
process.on('SIGINT', () => {
  try { stopSlashSpinner && stopSlashSpinner(_slashSpinnerGlobal); } catch (_) {}
  console.log('\nCancelled.');
  process.exit(130);
});

let _slashSpinnerGlobal = null;

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
  console.log(`\nUsage: ${invoked} [options]\n\nTargets:\n  --scope personal|project        Install to ~/.factory (default) or <repo>/.factory\n  --path <repo-root>              Required when --scope=project\n\nSelection (defaults: commands=all, droids=all):\n  --commands all|name1,name2      Install all or specific commands\n  --droids all|name1,name2        Install all or specific droids\n  --no-commands                   Skip installing commands\n  --no-droids                     Skip installing droids\n  --only-commands                 Commands only (implies --no-droids)\n  --only-droids                   Droids only (implies --no-commands)\n  --list                          List available templates then exit\n\nOther:\n  --force                         Overwrite existing files\n  --yes, -y                      Skip confirmation prompt\n  --dry-run                      Show plan only (no writes)\n  --verbose                       Verbose logging\n  -h, --help                      Show this help\n\nNotes:\n- Names refer to template basenames (e.g. code-review, security-code-reviewer).\n- Defaults install to personal scope → ~/.factory/{commands,droids}.\n- When --scope=project, pass --path pointing at the repo root.\n`);
}

function listBasenames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

async function runGuidedFlow(availableCommands, availableDroids) {
  const workspaceDir = path.join(os.homedir(), '.factory');
  const projectDir = path.join(process.cwd(), '.factory');

  // Step 1: location
  const scope = await new Select({
    name: 'scope',
    message: 'Step 1/4 — Choose install location',
    choices: [
      { name: 'personal', message: `Personal workspace (${workspaceDir})` },
      { name: 'project', message: `This project (${projectDir})` }
    ],
    hint: dim('Use ↑/↓ then Enter'),
    prefix: green(SYM_CHECK),
    onCancel: () => { console.log('Cancelled.'); process.exit(0); }
  }).run();

  // Compute install base to discover existing items
  const baseDir = scope === 'personal' ? workspaceDir : projectDir;
  const destCommands = path.join(baseDir, 'commands');
  const destDroids = path.join(baseDir, 'droids');
  const installedCommands = new Set(listBasenames(destCommands));
  const installedDroids = new Set(listBasenames(destDroids));

  // Step 2: install-all
  const installAll = await new Confirm({
    name: 'all',
    message: 'Step 2/4 — Install all commands and droids?',
    initial: true,
    hint: dim(`Currently installed: ${installedCommands.size} ${plural(installedCommands.size, 'command')}, ${installedDroids.size} ${plural(installedDroids.size, 'droid')}`),
    prefix: green(SYM_CHECK),
    onCancel: () => { console.log('Cancelled.'); process.exit(0); }
  }).run();

  let chosenCommands = [];
  let chosenDroids = [];
  if (!installAll) {
    const templateDir = path.join(__dirname, '..', 'templates');
    const templateCommands = path.join(templateDir, 'commands');
    const templateDroids = path.join(templateDir, 'droids');

    // Step 3: commands
    if (availableCommands.length) {
      const cmdDescMap = Object.create(null);
      const cmdChoices = availableCommands.map((name) => {
        const desc = getTemplateDescription(path.join(templateCommands, `${name}.md`));
        if (desc) cmdDescMap[name] = desc;
        const label = `/${name}${installedCommands.has(name) ? ' (installed)' : ''}`;
        return { name, value: name, message: truncate(label, termWidth() - 6) };
      });
      const initial = availableCommands.filter((n) => installedCommands.has(n));
      const cmdPrompt = new MultiSelect({
        name: 'commands',
        message: 'Step 3/4 — Select commands to install',
        choices: cmdChoices,
        initial,
        hint: dim('Space to toggle, Enter to confirm'),
        prefix: green(SYM_CHECK),
        symbols: { check: '*', cross: 'x', pointer: '>' },
        indicator(state, choice) {
          const mark = choice.enabled ? '*' : ' ';
          const ptr = state.index === choice.index ? '>' : ' ';
          return `${ptr} ${mark}`;
        },
        footer() {
          const idx = this.state?.index ?? 0;
          const current = this.choices?.[idx];
          const key = current ? (current.value ?? current.name) : '';
          const desc = key ? cmdDescMap[key] : '';
          return desc ? dim(truncate(desc, termWidth() - 2)) : '';
        },
        onCancel: () => { console.log('Cancelled.'); process.exit(0); }
      });
      chosenCommands = await cmdPrompt.run();
    }

    // Step 4: droids
    if (availableDroids.length) {
      const drDescMap = Object.create(null);
      const drChoices = availableDroids.map((name) => {
        const desc = getTemplateDescription(path.join(templateDroids, `${name}.md`));
        if (desc) drDescMap[name] = desc;
        const label = `${name}${installedDroids.has(name) ? ' (installed)' : ''}`;
        return { name, value: name, message: truncate(label, termWidth() - 6) };
      });
      const initial = availableDroids.filter((n) => installedDroids.has(n));
      const drPrompt = new MultiSelect({
        name: 'droids',
        message: 'Step 4/4 — Select droids to install',
        choices: drChoices,
        initial,
        hint: dim('Space to toggle, Enter to confirm'),
        prefix: green(SYM_CHECK),
        symbols: { check: '*', cross: 'x', pointer: '>' },
        indicator(state, choice) {
          const mark = choice.enabled ? '*' : ' ';
          const ptr = state.index === choice.index ? '>' : ' ';
          return `${ptr} ${mark}`;
        },
        footer() {
          const idx = this.state?.index ?? 0;
          const current = this.choices?.[idx];
          const key = current ? (current.value ?? current.name) : '';
          const desc = key ? drDescMap[key] : '';
          return desc ? dim(truncate(desc, termWidth() - 2)) : '';
        },
        onCancel: () => { console.log('Cancelled.'); process.exit(0); }
      });
      chosenDroids = await drPrompt.run();
    }
  }

  const force = await new Confirm({
    name: 'force',
    message: 'Overwrite existing files if found?',
    initial: false,
    hint: dim('Choosing No will skip pre-existing files'),
    prefix: green(SYM_CHECK),
    onCancel: () => { console.log('Cancelled.'); process.exit(0); }
  }).run();

  const args = {
    scope,
    path: scope === 'project' ? process.cwd() : '',
    force,
    yes: true
  };

  if (installAll) {
    args.commands = 'all';
    args.droids = 'all';
    args.noCommands = false;
    args.noDroids = false;
  } else {
    if (chosenCommands.length) args.commands = chosenCommands.join(',');
    else args.noCommands = true;
    if (chosenDroids.length) args.droids = chosenDroids.join(',');
    else args.noDroids = true;
  }

  return args;
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

// Spinner removed for simplicity; install runs fast and shows a polished summary

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
  if (normalized === 'q' || normalized === 'quit' || normalized === 'exit') {
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

  const isGuidedCandidate = canPrompt()
    && !args.list && !args.help
    && args.commands === undefined && args.droids === undefined
    && !args.noCommands && !args.noDroids && !args.onlyCommands && !args.onlyDroids;

  if (isGuidedCandidate) {
    try {
      const enq = require('enquirer');
      if (enq && enq.symbols) {
        enq.symbols.check = '*';
        enq.symbols.cross = 'x';
        enq.symbols.question = '?';
        enq.symbols.pointer = '>';
        enq.symbols.ellipsis = '...';
      }
      ({ Select, MultiSelect, Confirm } = enq);
      const guided = await runGuidedFlow(availableCommands, availableDroids);
      Object.assign(args, guided);
      args.yes = true; // ensure no legacy confirm
    } catch (e) {
      // If enquirer is unavailable for any reason, fall back to flags/defaults
    }
  }

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
    const projectRoot = args.path || process.cwd();
    baseDir = path.join(path.resolve(projectRoot), '.factory');
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

  const guidedMode = isGuidedCandidate && args.yes; // guided flow ran and auto-confirm enabled
  if (!guidedMode) {
    if (args.verbose) printPlan(plan, args, destCommands, destDroids);
  } else {
    // Defer styled "Installing to:" output until the final guided summary
  }

  // Custom droids status will be reported in the final guided summary (no early output)

  if (args.dryRun) {
    console.log('\nDry run: no files were written.');
    return;
  }

  const confirmedArgs = await confirmIfNeeded(args);

  if (!confirmedArgs.noCommands) ensureDir(destCommands);
  if (!confirmedArgs.noDroids) ensureDir(destDroids);

  const copyResults = { commands: new Map(), droids: new Map() };

  // Show an ASCII spinner during installation when not verbose
  const spinEnabled = process.stdout.isTTY && !confirmedArgs.verbose;
  let spinnerTimer = spinEnabled ? startSlashSpinner('Installing...') : null;
  _slashSpinnerGlobal = spinnerTimer;

  if (!confirmedArgs.noCommands) {
    for (const item of plan.commands) {
      if (!fs.existsSync(item.src)) {
        if (confirmedArgs.verbose) console.log(`skip   ${item.name} (template not found)`);
        continue;
      }
      const result = copyFile(item.src, item.dest, confirmedArgs.force);
      copyResults.commands.set(item.name, result);
      if (confirmedArgs.verbose) {
        // Pause spinner for clean logging
        stopSlashSpinner(spinnerTimer); spinnerTimer = null;
        const label = result === 'skipped' ? 'skip   ' : 'wrote  ';
        console.log(`${label}${item.dest}`);
        if (spinEnabled) spinnerTimer = startSlashSpinner('Installing...');
      }
    }
  }

  if (!confirmedArgs.noDroids) {
    for (const item of plan.droids) {
      if (!fs.existsSync(item.src)) {
        if (confirmedArgs.verbose) console.log(`skip   ${item.name} (template not found)`);
        continue;
      }
      const result = copyFile(item.src, item.dest, confirmedArgs.force);
      copyResults.droids.set(item.name, result);
      if (confirmedArgs.verbose) {
        stopSlashSpinner(spinnerTimer); spinnerTimer = null;
        const label = result === 'skipped' ? 'skip   ' : 'wrote  ';
        console.log(`${label}${item.dest}`);
        if (spinEnabled) spinnerTimer = startSlashSpinner('Installing...');
      }
    }
  }

  // Stop spinner before summary
  stopSlashSpinner(spinnerTimer); spinnerTimer = null; _slashSpinnerGlobal = null;

  const writtenCmds = plan.commands.filter(it => copyResults.commands.get(it.name) === 'written');
  const writtenDrs  = plan.droids.filter(it => copyResults.droids.get(it.name) === 'written');
  const overwritten = writtenCmds.filter(it => it.exists).length + writtenDrs.filter(it => it.exists).length;
  const created = writtenCmds.filter(it => !it.exists).length + writtenDrs.filter(it => !it.exists).length;
  const skipped = Array.from(copyResults.commands.values()).filter(v => v === 'skipped').length
                   + Array.from(copyResults.droids.values()).filter(v => v === 'skipped').length;

  const guidedSummary = () => {
    const base = args.scope === 'personal' ? path.join(os.homedir(), '.factory') : path.join(process.cwd(), '.factory');
    const st = readCustomDroidsSetting();
    const enabled = !!st.enabled && !st.error && !st.missing;

    // Only show skipped steps (Enquirer already printed the completed ones)
    const allSelected = (args.commands === 'all' && args.droids === 'all');
    if (allSelected) {
      console.log(`${green(SYM_CHECK)} ${bold('Step 3/4 — Select commands to install')} ${dim('·')} ${cyan('(skipped)')}`);
      console.log(`${green(SYM_CHECK)} ${bold('Step 4/4 — Select droids to install')} ${dim('·')} ${cyan('(skipped)')}`);
    } else {
      if (args.noCommands) console.log(`${green(SYM_CHECK)} ${bold('Step 3/4 — Select commands to install')} ${dim('·')} ${cyan('(skipped)')}`);
      if (args.noDroids) console.log(`${green(SYM_CHECK)} ${bold('Step 4/4 — Select droids to install')} ${dim('·')} ${cyan('(skipped)')}`);
    }

    console.log(`${SYM_ARROW} Installing to: ${cyan(base)}`);

    // Custom droids status line
    if (enabled) {
      console.log(`${green(SYM_CHECK)} Custom droids are enabled in your settings.`);
    } else {
      console.log(`${SYM_ARROW} Custom droids need to be enabled in settings.`);
      console.log(`${SYM_ARROW} Open /settings → Experimental → Custom Droids, or set enableCustomDroids: true in ~/.factory/settings.json`);
    }

    // Final lines
    console.log(`${green(SYM_CHECK)} Completed — ${created} created, ${overwritten} overwritten, ${skipped} skipped.`);
    if (!enabled) {
      console.log(`${SYM_ARROW} Next: Enable Custom Droids as described above.`);
    }
    console.log(`${SYM_ARROW} Next: Restart Droid (Ctrl+C then relaunch) or run /commands and press R to reload.`);
  };

  if (guidedMode) guidedSummary();
  else {
    console.log(`\n${green(SYM_CHECK)} Completed — ${created} created, ${overwritten} overwritten, ${skipped} skipped.`);
    console.log(`${SYM_ARROW} Next: Restart Droid (Ctrl+C then relaunch) or run /commands and press R to reload.`);
  }
}

main().catch((err) => {
  console.error('Installation failed:', err?.message || err);
  process.exit(1);
});
