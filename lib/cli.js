"use strict";

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const { parseArgs, usage } = require('./args');
const output = require('./output');
const { listBasenames, ensureDir, copyFile, readCustomDroidsSetting, downloadToFile } = require('./fs-utils');
const { resolveSelection, computePlan } = require('./planner');
const spinner = require('./spinner');
const { guidedFlow, configureAsciiTheme, selectScope, chooseImportSource, guidedTemplatesFlowFromScope, BACK, RESET } = require('./ui');
const { guidedMarketplaceFlowFromScope } = require('./marketplace-ui');
const { loadMarketplace, discoverPlugins, getLastRateLimit } = require('./marketplace');

function canPrompt() { return process.stdin.isTTY && process.stdout.isTTY; }

function logMarketplaceDiscoveryWarnings(discovered, debug) {
  if (debug) return false;
  const errored = (discovered || []).filter((p) => Array.isArray(p.errors) && p.errors.length);
  if (!errored.length) return false;
  console.log('\nWarning: Some plugins could not be fully discovered:');
  for (const plugin of errored) {
    console.log(`  - ${plugin.name}: ${plugin.errors[0]}`);
  }
  console.log('  Consider setting GITHUB_TOKEN to increase GitHub API limits.');
  return true;
}

function logRateLimitIfLow(debug) {
  if (debug) return;
  const info = getLastRateLimit && getLastRateLimit();
  if (!info) return;
  const { remaining, limit, reset } = info;
  if (typeof remaining !== 'number' || remaining > 5) return;
  const resetIn = typeof reset === 'number' ? Math.max(0, Math.round((reset * 1000 - Date.now()) / 1000)) : null;
  console.log('\nWarning: GitHub API rate limit nearly exhausted.');
  if (typeof remaining === 'number' && typeof limit === 'number') {
    console.log(`  Remaining ${remaining}/${limit} requests for this hour.`);
  } else if (typeof remaining === 'number') {
    console.log(`  Remaining requests: ${remaining}.`);
  }
  if (resetIn !== null) {
    const mins = Math.floor(resetIn / 60);
    const secs = resetIn % 60;
    console.log(`  Resets in ~${mins}m ${secs}s.`);
  }
  console.log('  Set GITHUB_TOKEN to increase limits.');
}

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
    && !args.onlyCommands && !args.onlyDroids;

  // Guided entry with source selection if no explicit mode provided
  if (isGuidedCandidate && !args.marketplace && !args.import && args.commands === undefined && args.droids === undefined) {
    try {
      configureAsciiTheme(require('enquirer'));
      
      // State machine for navigation with back support
      let step = 'scope';
      let scopeChoice = null;
      let srcChoice = null;
      
      while (true) {
        if (step === 'scope') {
          scopeChoice = await selectScope('Step 1/6 — Choose install location');
          if (scopeChoice === RESET) { scopeChoice = null; srcChoice = null; step = 'scope'; if (process.stdout.isTTY) { try { console.clear(); } catch {} } continue; }
          step = 'source';
        } else if (step === 'source') {
          srcChoice = await chooseImportSource(false);
          if (srcChoice === RESET) { scopeChoice = null; srcChoice = null; step = 'scope'; if (process.stdout.isTTY) { try { console.clear(); } catch {} } continue; }
          step = 'flow';
        } else if (step === 'flow') {
          if (srcChoice === 'marketplace') {
            const result = await guidedMarketplaceFlowFromScope({ scope: scopeChoice, debug: args.debug, ref: args.ref });
            if (result.args === RESET) { scopeChoice = null; srcChoice = null; step = 'scope'; if (process.stdout.isTTY) { try { console.clear(); } catch {} } continue; }
            Object.assign(args, result.args);
            args.yes = true;
            args.__loadedMarketplace = { loaded: result.loaded, discovered: result.discovered, warningsShown: result.warningsShown };
          } else {
            const guided = await guidedTemplatesFlowFromScope({
              scope: scopeChoice,
              availableCommands,
              availableDroids,
              templateCommandsDir: templateCommands,
              templateDroidsDir: templateDroids,
            });
            if (guided === RESET) { scopeChoice = null; srcChoice = null; step = 'scope'; if (process.stdout.isTTY) { try { console.clear(); } catch {} } continue; }
            Object.assign(args, guided);
            args.yes = true;
          }
          break; // Exit the loop when flow completes successfully
        }
      }
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

  // Marketplace branch
  if (args.marketplace || args.import === 'marketplace' || args.__loadedMarketplace) {
    // Load marketplace and discover plugins
    let loaded = null;
    let discovered = null;
    let warningsShown = false;
    if (args.__loadedMarketplace) {
      loaded = args.__loadedMarketplace.loaded;
      discovered = args.__loadedMarketplace.discovered;
      warningsShown = !!args.__loadedMarketplace.warningsShown;
    } else {
      try {
        let fetchSpin = null;
        const spinEnabled = process.stdout.isTTY && !args.verbose && !args.debug;
        if (spinEnabled) fetchSpin = spinner.start('Fetching marketplace...');
        loaded = await loadMarketplace(args.marketplace || '', args.ref, { debug: args.debug });
        discovered = await discoverPlugins(loaded.json, loaded.context, { debug: args.debug });
        spinner.stop(fetchSpin);
        warningsShown = logMarketplaceDiscoveryWarnings(discovered, args.debug);
        if (!args.debug) logRateLimitIfLow(args.debug);
      } catch (e) {
        console.error('Failed to load marketplace:', e?.message || e);
        process.exit(1);
      }
    }

    if (!warningsShown) warningsShown = logMarketplaceDiscoveryWarnings(discovered, args.debug);
    if (!args.debug) logRateLimitIfLow(args.debug);
    if (args.__loadedMarketplace) args.__loadedMarketplace.warningsShown = warningsShown;

    // Selection
    let selectedPlugins;
    if (args.plugins === undefined) {
      // Non-interactive without explicit selection → all
      selectedPlugins = 'all';
    } else if (args.plugins === 'all') {
      selectedPlugins = 'all';
    } else if (typeof args.plugins === 'string') {
      const arr = args.plugins.split(',').map((s) => s.trim()).filter(Boolean);
      selectedPlugins = arr.length ? arr : [];
    } else {
      selectedPlugins = [];
    }
    const { computeMarketplacePlan } = require('./marketplace-planner');
    const plan = computeMarketplacePlan({
      selectedPlugins,
      discovered,
      destCommandsDir: destCommands,
      destDroidsDir: destDroids,
    });

    if (args.verbose) output.printMarketplacePlan(plan, args, destCommands, destDroids);
    if (args.dryRun) { console.log('\nDry run: no files were written.'); return; }

    if (!plan.commands.length && !plan.droids.length) {
      console.log('Nothing to install (no plugins or components selected).');
      return;
    }

    const confirmedArgs = await confirmIfNeeded(args);
    if (plan.commands.length) ensureDir(destCommands);
    if (plan.droids.length) ensureDir(destDroids);

    let spinnerTimer = null;
    const spinEnabled = process.stdout.isTTY && !confirmedArgs.verbose && !confirmedArgs.debug;
    const sigintHandler = () => { spinner.stop(spinnerTimer); console.log('\nCancelled.'); process.exit(130); };
    process.on('SIGINT', sigintHandler);
    if (spinEnabled) spinnerTimer = spinner.start('Installing...');

    const copyResults = { commands: new Map(), droids: new Map() };
    try {
      // Commands
      for (const item of plan.commands) {
        const existed = fs.existsSync(item.dest);
        let result = 'skipped';
        if (item.srcType === 'local') {
          if (!fs.existsSync(item.src)) { if (confirmedArgs.verbose) console.log(`skip   ${item.name} (source not found)`); continue; }
          result = copyFile(item.src, item.dest, confirmedArgs.force);
        } else {
          result = await downloadToFile(item.src, item.dest, confirmedArgs.force);
        }
        copyResults.commands.set(item.name, { result, existed });
        if (confirmedArgs.verbose) {
          spinner.stop(spinnerTimer); spinnerTimer = null;
          const label = result === 'skipped' ? 'skip   ' : 'wrote  ';
          console.log(`${label}${item.dest}`);
          if (spinEnabled) spinnerTimer = spinner.start('Installing...');
        }
      }
      // Droids
      for (const item of plan.droids) {
        const existed = fs.existsSync(item.dest);
        let result = 'skipped';
        if (item.srcType === 'local') {
          if (!fs.existsSync(item.src)) { if (confirmedArgs.verbose) console.log(`skip   ${item.name} (source not found)`); continue; }
          result = copyFile(item.src, item.dest, confirmedArgs.force);
        } else {
          result = await downloadToFile(item.src, item.dest, confirmedArgs.force);
        }
        copyResults.droids.set(item.name, { result, existed });
        if (confirmedArgs.verbose) {
          spinner.stop(spinnerTimer); spinnerTimer = null;
          const label = result === 'skipped' ? 'skip   ' : 'wrote  ';
          console.log(`${label}${item.dest}`);
          if (spinEnabled) spinnerTimer = spinner.start('Installing...');
        }
      }
    } finally {
      spinner.stop(spinnerTimer); spinnerTimer = null; process.off('SIGINT', sigintHandler);
    }

    // Count results
    const writtenCmds = plan.commands.filter(it => (copyResults.commands.get(it.name)?.result) === 'written');
    const writtenDrs  = plan.droids.filter(it => (copyResults.droids.get(it.name)?.result) === 'written');
    const overwritten = writtenCmds.filter(it => copyResults.commands.get(it.name)?.existed).length + writtenDrs.filter(it => copyResults.droids.get(it.name)?.existed).length;
    const created = writtenCmds.filter(it => !copyResults.commands.get(it.name)?.existed).length + writtenDrs.filter(it => !copyResults.droids.get(it.name)?.existed).length;
    const skipped = Array.from(copyResults.commands.values()).filter(v => v.result === 'skipped').length + Array.from(copyResults.droids.values()).filter(v => v.result === 'skipped').length;

    const basePath = (args.scope === 'personal') ? path.join(os.homedir(), '.factory') : path.join(process.cwd(), '.factory');
    const custom = readCustomDroidsSetting();
    const enabled = !!custom.enabled && !custom.error && !custom.missing;

    output.printSummary({ guided: false, args, basePath, created, overwritten, skipped, customDroidsEnabled: enabled, plan });
    return;
  }

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
