"use strict";

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const { parseArgs, usage } = require('./args');
const output = require('./output');
const { listBasenames, ensureDir, copyFile, readCustomDroidsSetting } = require('./fs-utils');
const { resolveSelection, computePlan } = require('./planner');
const spinner = require('./spinner');
const { guidedFlow, configureAsciiTheme } = require('./ui');

function canPrompt() { return process.stdin.isTTY && process.stdout.isTTY; }

async function confirmIfNeeded(args) {
  const interactive = canPrompt() && !args.yes && !args.dryRun;
  if (!interactive) return args; // unchanged
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => { rl.question('\nProceed? [y] Yes / [f] Force overwrite / [n] Cancel: ', resolve); });
  rl.close();
  const normalized = (answer || '').trim().toLowerCase();
  if (normalized === 'n' || normalized === 'no' || normalized === 'q' || normalized === 'quit' || normalized === 'exit') {
    console.log('Cancelled.');
    process.exit(0);
  }
  if (normalized === 'f' || normalized === 'force') return { ...args, force: true };
  return args;
}

async function run(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(usage(argv[1])); return; }

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
      configureAsciiTheme(require('enquirer'));
      const guided = await guidedFlow({
        availableCommands,
        availableDroids,
        templateCommandsDir: templateCommands,
        templateDroidsDir: templateDroids,
      });
      Object.assign(args, guided);
      args.yes = true; // ensure no legacy confirm
    } catch (e) {
      // fall back to flags/defaults
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
  if (args.scope === 'personal' || !args.scope) baseDir = path.join(os.homedir(), '.factory');
  else if (args.scope === 'project') baseDir = path.join(path.resolve(args.path || process.cwd()), '.factory');
  else { console.error(`Error: unknown --scope '${args.scope}'. Use 'personal' or 'project'.`); process.exit(2); }

  const destCommands = path.join(baseDir, 'commands');
  const destDroids = path.join(baseDir, 'droids');

  const selectedCommands = args.noCommands ? [] : (resolveSelection(args.commands, availableCommands, 'command') || [...availableCommands]);
  const selectedDroids = args.noDroids ? [] : (resolveSelection(args.droids, availableDroids, 'droid') || [...availableDroids]);
  if (!selectedCommands.length && !selectedDroids.length) { console.log('Nothing to install (no commands or droids selected).'); return; }

  const plan = computePlan({
    selectedCommands,
    selectedDroids,
    templateCommandsDir: templateCommands,
    templateDroidsDir: templateDroids,
    destCommandsDir: destCommands,
    destDroidsDir: destDroids,
  });

  const guidedMode = isGuidedCandidate && args.yes;
  if (!guidedMode) {
    if (args.verbose) output.printPlan(plan, args, destCommands, destDroids);
  }

  if (args.dryRun) { console.log('\nDry run: no files were written.'); return; }

  const confirmedArgs = await confirmIfNeeded(args);

  if (!confirmedArgs.noCommands) ensureDir(destCommands);
  if (!confirmedArgs.noDroids) ensureDir(destDroids);

  let spinnerTimer = null;
  const spinEnabled = process.stdout.isTTY && !confirmedArgs.verbose;
  const sigintHandler = () => { spinner.stop(spinnerTimer); console.log('\nCancelled.'); process.exit(130); };
  process.on('SIGINT', sigintHandler);
  if (spinEnabled) spinnerTimer = spinner.start('Installing...');

  const copyResults = { commands: new Map(), droids: new Map() };
  try {
    if (!confirmedArgs.noCommands) {
      for (const item of plan.commands) {
        if (!fs.existsSync(item.src)) { if (confirmedArgs.verbose) console.log(`skip   ${item.name} (template not found)`); continue; }
        const result = copyFile(item.src, item.dest, confirmedArgs.force);
        copyResults.commands.set(item.name, result);
        if (confirmedArgs.verbose) {
          spinner.stop(spinnerTimer); spinnerTimer = null;
          const label = result === 'skipped' ? 'skip   ' : 'wrote  ';
          console.log(`${label}${item.dest}`);
          if (spinEnabled) spinnerTimer = spinner.start('Installing...');
        }
      }
    }
    if (!confirmedArgs.noDroids) {
      for (const item of plan.droids) {
        if (!fs.existsSync(item.src)) { if (confirmedArgs.verbose) console.log(`skip   ${item.name} (template not found)`); continue; }
        const result = copyFile(item.src, item.dest, confirmedArgs.force);
        copyResults.droids.set(item.name, result);
        if (confirmedArgs.verbose) {
          spinner.stop(spinnerTimer); spinnerTimer = null;
          const label = result === 'skipped' ? 'skip   ' : 'wrote  ';
          console.log(`${label}${item.dest}`);
          if (spinEnabled) spinnerTimer = spinner.start('Installing...');
        }
      }
    }
  } finally {
    spinner.stop(spinnerTimer); spinnerTimer = null; process.off('SIGINT', sigintHandler);
  }

  const writtenCmds = plan.commands.filter(it => copyResults.commands.get(it.name) === 'written');
  const writtenDrs  = plan.droids.filter(it => copyResults.droids.get(it.name) === 'written');
  const overwritten = writtenCmds.filter(it => it.exists).length + writtenDrs.filter(it => it.exists).length;
  const created = writtenCmds.filter(it => !it.exists).length + writtenDrs.filter(it => !it.exists).length;
  const skipped = Array.from(copyResults.commands.values()).filter(v => v === 'skipped').length + Array.from(copyResults.droids.values()).filter(v => v === 'skipped').length;

  const basePath = (args.scope === 'personal') ? path.join(os.homedir(), '.factory') : path.join(process.cwd(), '.factory');
  const custom = readCustomDroidsSetting();
  const enabled = !!custom.enabled && !custom.error && !custom.missing;

  output.printSummary({ guided: guidedMode, args, basePath, created, overwritten, skipped, customDroidsEnabled: enabled, plan });
}

module.exports = { run };
