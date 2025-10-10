"use strict";

const os = require('os');
const path = require('path');
const { colors, symbols, helpers } = require('./output');
const { listBasenames, getTemplateDescription } = require('./fs-utils');

const { dim, green, cyan } = colors;
const { CHECK } = symbols;
const { plural, termWidth, truncate } = helpers;

function configureAsciiTheme(enquirer) {
  if (enquirer && enquirer.symbols) {
    enquirer.symbols.check = '*';
    enquirer.symbols.cross = 'x';
    enquirer.symbols.question = '?';
    enquirer.symbols.pointer = '>';
    enquirer.symbols.ellipsis = '...';
  }
}

function createMultiSelectWithFooter(EnquirerMultiSelect, { title, choices, initial }) {
  return new EnquirerMultiSelect({
    name: 'items',
    message: title,
    choices,
    initial,
    hint: dim('Space to toggle, Enter to confirm'),
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
    onCancel: () => { console.log('Cancelled.'); process.exit(0); }
  });
}

async function guidedFlow({ availableCommands, availableDroids, templateCommandsDir, templateDroidsDir }) {
  const { Select, MultiSelect, Confirm } = require('enquirer');
  configureAsciiTheme(require('enquirer'));

  const workspaceDir = path.join(os.homedir(), '.factory');
  const projectDir = path.join(process.cwd(), '.factory');

  const scope = await new Select({
    name: 'scope',
    message: 'Step 1/4 — Choose install location',
    choices: [
      { name: 'personal', message: `Personal workspace (${workspaceDir})` },
      { name: 'project', message: `This project (${projectDir})` }
    ],
    hint: dim('Use ↑/↓ then Enter'),
    prefix: green(CHECK),
    onCancel: () => { console.log('Cancelled.'); process.exit(0); }
  }).run();

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

module.exports = { configureAsciiTheme, guidedFlow };
