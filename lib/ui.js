"use strict";

const os = require('os');
const path = require('path');
const { colors, symbols, helpers } = require('./output');
const { listBasenames, getTemplateDescription } = require('./fs-utils');

const { dim, green, cyan } = colors;
const { CHECK } = symbols;
const { plural, termWidth, truncate } = helpers;

// Back marker (kept for compatibility) and Reset marker
const BACK = Symbol('BACK');
const RESET = Symbol('RESET');

// Helper to clear lines from terminal (moves cursor up and clears)
function clearLines(count) {
  if (!process.stdout.isTTY) return;
  for (let i = 0; i < count; i++) {
    process.stdout.moveCursor(0, -1); // Move cursor up one line
    process.stdout.clearLine(0); // Clear the line
    process.stdout.cursorTo(0); // Move cursor to start
  }
}

function configureAsciiTheme(enquirer) {
  if (enquirer && enquirer.symbols) {
    enquirer.symbols.check = '*';
    enquirer.symbols.cross = 'x';
    enquirer.symbols.question = '?';
    enquirer.symbols.pointer = '>';
    enquirer.symbols.ellipsis = '...';
  }
}

function createMultiSelectWithFooter(EnquirerMultiSelect, { title, choices, initial, allowBack = false }) {
  const prompt = new EnquirerMultiSelect({
    name: 'items',
    message: title,
    choices,
    initial,
    hint: dim('Space to toggle, Enter to confirm · q to quit · esc to restart'),
    prefix: green(CHECK),
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
      const desc = current && current.data && current.data.desc ? current.data.desc : '';
      return desc ? dim(truncate(desc, termWidth() - 2)) : '';
    },
    onCancel() { if (this.__reset) return; console.log('Cancelled.'); process.exit(0); }
  });

  return prompt;
}

function attachEscReset(prompt) {
  if (!prompt) return prompt;
  prompt.__reset = false;
  prompt.on('keypress', (ch, key) => {
    if (key && key.name === 'escape') {
      prompt.__reset = true;
      try { prompt.cancel(); } catch {}
    }
    // 'q' quits (cancel) without reset
    if ((ch === 'q' || ch === 'Q') || (key && key.name && key.name.toLowerCase() === 'q')) {
      try { prompt.cancel(); } catch {}
    }
  });
  return prompt;
}

async function runWithReset(prompt) {
  attachEscReset(prompt);
  try {
    return await prompt.run();
  } catch (e) {
    if (prompt.__reset) return RESET;
    throw e;
  }
}

async function selectScope(messageLabel = 'Choose install location') {
  const { Select } = require('enquirer');
  configureAsciiTheme(require('enquirer'));
  const workspaceDir = path.join(os.homedir(), '.factory');
  const projectDir = path.join(process.cwd(), '.factory');
  const prompt = new Select({
    name: 'scope',
    message: messageLabel,
    choices: [
      { name: 'personal', message: `Personal workspace (${workspaceDir})` },
      { name: 'project', message: `This project (${projectDir})` }
    ],
    hint: dim('Use ↑/↓ then Enter · q to quit · esc to restart'),
    prefix: green(CHECK),
    symbols: { check: '*', cross: 'x', pointer: '>' },
    onCancel() { if (this.__reset) return; console.log('Cancelled.'); process.exit(0); }
  });

  const result = await runWithReset(prompt);

  return result;
}

async function chooseImportSource(allowBack = false) {
  const { Select } = require('enquirer');
  configureAsciiTheme(require('enquirer'));
  const prompt = new Select({
    name: 'import',
    message: 'Step 2/6 — Choose import source',
    choices: [
      { name: 'templates', message: 'Built-in templates (Droid Factory)', value: 'templates' },
      { name: 'marketplace', message: 'Claude Code marketplace', value: 'marketplace' }
    ],
    hint: dim('Use ↑/↓ then Enter · q to quit · esc to restart'),
    prefix: green(CHECK),
    symbols: { check: '*', cross: 'x', pointer: '>' },
    onCancel() { if (this.__reset) return; console.log('Cancelled.'); process.exit(0); }
  });
  const result = await runWithReset(prompt);
  return result;
}

async function guidedFlow({ availableCommands, availableDroids, templateCommandsDir, templateDroidsDir }) {
  const { MultiSelect, Confirm } = require('enquirer');
  configureAsciiTheme(require('enquirer'));

  const scope = await selectScope('Step 1/4 — Choose install location');

  // Correctly resolve base directories
  const workspaceDir = path.join(os.homedir(), '.factory');
  const projectDir = path.join(process.cwd(), '.factory');
  const baseDir = scope === 'personal' ? workspaceDir : projectDir;
  const destCommands = path.join(baseDir, 'commands');
  const destDroids = path.join(baseDir, 'droids');
  const installedCommands = new Set(listBasenames(destCommands));
  const installedDroids = new Set(listBasenames(destDroids));

  const installAll = await new Confirm({
    name: 'all',
    message: 'Step 2/4 — Install all commands and droids?',
    initial: true,
    hint: dim(`Currently installed: ${installedCommands.size} ${plural(installedCommands.size, 'command')}, ${installedDroids.size} ${plural(installedDroids.size, 'droid')}`),
    prefix: green(CHECK),
    onCancel: () => { console.log('Cancelled.'); process.exit(0); }
  }).run();

  let chosenCommands = [];
  let chosenDroids = [];
  if (!installAll) {
    if (availableCommands.length) {
      const cmdChoices = availableCommands.map((name) => {
        const label = `/${name}${installedCommands.has(name) ? ' (installed)' : ''}`;
        const desc = templateCommandsDir ? getTemplateDescription(path.join(templateCommandsDir, `${name}.md`)) : null;
        return { name, value: name, message: truncate(label, termWidth() - 6), data: { desc } };
      });
      // Fill desc lazily on render via data; simpler: resolve from template during build in caller if needed
      const cmdPrompt = createMultiSelectWithFooter(MultiSelect, {
        title: 'Step 3/4 — Select commands to install',
        choices: cmdChoices,
        initial: availableCommands.filter((n) => installedCommands.has(n))
      });
      chosenCommands = await cmdPrompt.run();
    }

    if (availableDroids.length) {
      const drChoices = availableDroids.map((name) => {
        const label = `${name}${installedDroids.has(name) ? ' (installed)' : ''}`;
        const desc = templateDroidsDir ? getTemplateDescription(path.join(templateDroidsDir, `${name}.md`)) : null;
        return { name, value: name, message: truncate(label, termWidth() - 6), data: { desc } };
      });
      const drPrompt = createMultiSelectWithFooter(MultiSelect, {
        title: 'Step 4/4 — Select droids to install',
        choices: drChoices,
        initial: availableDroids.filter((n) => installedDroids.has(n))
      });
      chosenDroids = await drPrompt.run();
    }
  }

  const force = await new Confirm({
    name: 'force',
    message: 'Overwrite existing files if found?',
    initial: false,
    hint: dim('Choosing No will skip pre-existing files'),
    prefix: green(CHECK),
    onCancel: () => { console.log('Cancelled.'); process.exit(0); }
  }).run();

  const args = { scope, path: scope === 'project' ? process.cwd() : '', force, yes: true };
  if (installAll) {
    args.commands = 'all';
    args.droids = 'all';
    args.noCommands = false;
    args.noDroids = false;
  } else {
    if (chosenCommands.length) args.commands = chosenCommands.join(','); else args.noCommands = true;
    if (chosenDroids.length) args.droids = chosenDroids.join(','); else args.noDroids = true;
  }
  return args;
}

async function guidedTemplatesFlowFromScope({ scope, availableCommands, availableDroids, templateCommandsDir, templateDroidsDir }) {
  configureAsciiTheme(require('enquirer'));

  const baseDir = scope === 'personal' ? path.join(os.homedir(), '.factory') : path.join(process.cwd(), '.factory');
  const destCommands = path.join(baseDir, 'commands');
  const destDroids = path.join(baseDir, 'droids');
  const installedCommands = new Set(listBasenames(destCommands));
  const installedDroids = new Set(listBasenames(destDroids));

  // State machine for nested navigation
  let step = 'installAll';
  let installAll = null;
  let chosenCommands = [];
  let chosenDroids = [];
  let force = false;

  while (true) {
    if (step === 'installAll') {
      const { Confirm } = require('enquirer');
      const installAllPrompt = new Confirm({
        name: 'all',
        message: 'Step 3/6 — Install all commands and droids?',
        initial: installAll !== null ? installAll : true,
        hint: dim(`Currently installed: ${installedCommands.size} ${plural(installedCommands.size, 'command')}, ${installedDroids.size} ${plural(installedDroids.size, 'droid')}`),
        prefix: green(CHECK),
        onCancel() { if (this.__reset) return; console.log('Cancelled.'); process.exit(0); }
      });
      const installAllRes = await runWithReset(installAllPrompt);
      if (installAllRes === RESET) return RESET;
      installAll = installAllRes;
      step = installAll ? 'force' : (availableCommands.length ? 'commands' : (availableDroids.length ? 'droids' : 'force'));
    } else if (step === 'commands') {
      const cmdChoices = availableCommands.map((name) => {
        const label = `/${name}${installedCommands.has(name) ? ' (installed)' : ''}`;
        const desc = templateCommandsDir ? getTemplateDescription(path.join(templateCommandsDir, `${name}.md`)) : null;
        return { name, value: name, message: truncate(label, termWidth() - 6), data: { desc } };
      });
      const { MultiSelect } = require('enquirer');
      const ms = createMultiSelectWithFooter(MultiSelect, {
        title: 'Step 4/6 — Select commands to install',
        choices: cmdChoices,
        initial: chosenCommands.length ? availableCommands.filter((n) => chosenCommands.includes(n)) : availableCommands.filter((n) => installedCommands.has(n))
      });
      const cmdRes = await runWithReset(ms);
      if (cmdRes === RESET) return RESET;
      chosenCommands = cmdRes;
      step = availableDroids.length ? 'droids' : 'force';
    } else if (step === 'droids') {
      const drChoices = availableDroids.map((name) => {
        const label = `${name}${installedDroids.has(name) ? ' (installed)' : ''}`;
        const desc = templateDroidsDir ? getTemplateDescription(path.join(templateDroidsDir, `${name}.md`)) : null;
        return { name, value: name, message: truncate(label, termWidth() - 6), data: { desc } };
      });
      const { MultiSelect } = require('enquirer');
      const ms = createMultiSelectWithFooter(MultiSelect, {
        title: 'Step 5/6 — Select droids to install',
        choices: drChoices,
        initial: chosenDroids.length ? availableDroids.filter((n) => chosenDroids.includes(n)) : availableDroids.filter((n) => installedDroids.has(n))
      });
      const drRes = await runWithReset(ms);
      if (drRes === RESET) return RESET;
      chosenDroids = drRes;
      step = 'force';
    } else if (step === 'force') {
      const { Confirm } = require('enquirer');
      const forcePrompt = new Confirm({
        name: 'force',
        message: 'Step 6/6 — Overwrite existing files if found?',
        initial: force,
        hint: dim('Choosing No will skip pre-existing files'),
        prefix: green(CHECK),
        onCancel() { if (this.__reset) return; console.log('Cancelled.'); process.exit(0); }
      });
      const forceRes = await runWithReset(forcePrompt);
      if (forceRes === RESET) return RESET;
      force = forceRes;
      break;
    }
  }

  const args = { scope, path: scope === 'project' ? process.cwd() : '', force, yes: true };
  if (installAll) {
    args.commands = 'all';
    args.droids = 'all';
    args.noCommands = false;
    args.noDroids = false;
  } else {
    if (chosenCommands.length) args.commands = chosenCommands.join(','); else args.noCommands = true;
    if (chosenDroids.length) args.droids = chosenDroids.join(','); else args.noDroids = true;
  }
  return args;
}

module.exports = { configureAsciiTheme, guidedFlow, selectScope, chooseImportSource, guidedTemplatesFlowFromScope, createMultiSelectWithFooter, BACK, RESET, runWithReset, attachEscReset };

