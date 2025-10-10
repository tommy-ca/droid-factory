"use strict";

const path = require('path');
const { colors, helpers } = require('./output');
const spinner = require('./spinner');
const { createMultiSelectWithFooter, runWithReset, RESET } = require('./ui');
const { loadMarketplace, discoverPlugins } = require('./marketplace');
const { configureAsciiTheme } = require('./ui');

const { dim, green } = colors;
const { truncate, termWidth, plural } = helpers;

function formatFooter(p) {
  const parts = [];
  const cmdCount = (p.commands || []).length;
  const agentCount = (p.agents || []).length;
  const hookCount = (p.hooks || []).length;
  if (cmdCount) parts.push(`${cmdCount} ${plural(cmdCount, 'command')}`);
  if (agentCount) parts.push(`${agentCount} ${plural(agentCount, 'agent')}`);
  if (hookCount) parts.push(`${hookCount} ${plural(hookCount, 'hook')} (not installed)`);
  const counts = parts.length ? parts.join(', ') : 'No installable templates';
  const desc = p.description ? ` — ${p.description}` : '';
  const error = Array.isArray(p.errors) && p.errors.length ? ` — Error: ${p.errors[0]}` : '';
  return truncate(`${counts}${desc}${error}`, termWidth() - 2);
}

async function guidedMarketplaceFlowFromScope({ scope, initialInput, debug = false, ref }) {
  const enq = require('enquirer');
  configureAsciiTheme(enq);
  const { Input, Confirm, MultiSelect } = enq;

  // State machine for nested navigation
  let step = 'marketplace';
  let marketplace = initialInput || '';
  let loaded = null;
  let discovered = null;
  let warningsShown = false;
  let installAll = null;
  let chosenPlugins = [];
  let force = false;

  while (true) {
    if (step === 'marketplace') {
      const marketplacePrompt = new Input({
        name: 'marketplace',
        message: 'Step 3/6 — Enter marketplace:',
        initial: marketplace,
        hint: dim('Accepts: path, GitHub owner/repo, or git URL.'),
        prefix: green('*'),
        symbols: { check: '*', cross: 'x', pointer: '>' },
        onCancel() { if (this.__reset) return; console.log('Cancelled.'); process.exit(0); }
      });
      const mktRes = await runWithReset(marketplacePrompt);
      if (mktRes === RESET) return { args: RESET };
      marketplace = mktRes;

      // Load + discover
      try {
        let sp = null;
        const spinEnabled = process.stdout.isTTY && !debug;
        if (spinEnabled) sp = spinner.start('Discovering plugins...');
        loaded = await loadMarketplace(marketplace, ref, { debug });
        discovered = await discoverPlugins(loaded.json, loaded.context, { debug });
        spinner.stop(sp);
      } catch (e) {
        spinner.stop();
        console.error('Failed to load marketplace:', e?.message || e);
        process.exit(1);
      }

      const erroredPlugins = discovered.filter((p) => Array.isArray(p.errors) && p.errors.length);
      warningsShown = !debug && erroredPlugins.length > 0;
      if (warningsShown) {
        console.log('\nWarning: Some plugins could not be fully discovered:');
        for (const plugin of erroredPlugins) {
          console.log(`  - ${plugin.name}: ${plugin.errors[0]}`);
        }
        console.log('  Consider setting GITHUB_TOKEN to increase GitHub API limits.');
      }
      step = 'installAll';
    } else if (step === 'installAll') {
      const totalCounts = discovered.reduce((acc, p) => {
        acc.commands += (p.commands || []).length;
        acc.agents += (p.agents || []).length;
        acc.hooks += (p.hooks || []).length;
        return acc;
      }, { commands: 0, agents: 0, hooks: 0 });
      const sections = [`${discovered.length} ${plural(discovered.length, 'plugin')}`];
      if (totalCounts.commands) sections.push(`${totalCounts.commands} ${plural(totalCounts.commands, 'command')}`);
      if (totalCounts.agents) sections.push(`${totalCounts.agents} ${plural(totalCounts.agents, 'agent')}`);
      if (totalCounts.hooks) sections.push(`${totalCounts.hooks} ${plural(totalCounts.hooks, 'hook')}`);
      const installAllPrompt = new Confirm({
        name: 'all',
        message: 'Step 4/6 — Install all plugins?',
        initial: installAll !== null ? installAll : true,
        hint: dim(`Discovered: ${sections.join(' · ')}`),
        prefix: green('*'),
        symbols: { check: '*', cross: 'x', pointer: '>' },
        onCancel() { if (this.__reset) return; console.log('Cancelled.'); process.exit(0); }
      });
      const allRes = await runWithReset(installAllPrompt);
      if (allRes === RESET) return { args: RESET };
      installAll = allRes;
      step = installAll ? 'force' : 'plugins';
    } else if (step === 'plugins') {
      const choices = discovered.map((p) => ({ name: p.name, value: p.name, message: p.name, data: { desc: formatFooter(p) } }));
      const ms = createMultiSelectWithFooter(MultiSelect, {
        title: 'Step 5/6 — Select plugins to install',
        choices,
        initial: chosenPlugins
      });
      const plugRes = await runWithReset(ms);
      if (plugRes === RESET) return { args: RESET };
      chosenPlugins = plugRes;
      step = 'force';
    } else if (step === 'force') {
      const forcePrompt = new Confirm({
        name: 'force',
        message: 'Step 6/6 — Overwrite existing files if found?',
        initial: force,
        hint: dim('Choosing No will skip pre-existing files'),
        prefix: green('*'),
        symbols: { check: '*', cross: 'x', pointer: '>' },
        onCancel() { if (this.__reset) return; console.log('Cancelled.'); process.exit(0); }
      });
      const forceRes = await runWithReset(forcePrompt);
      if (forceRes === RESET) return { args: RESET };
      force = forceRes;
      break; // Exit loop when force confirmation is done
    }
  }

  const args = { scope, marketplace, yes: true, force, debug };
  if (ref) args.ref = ref;
  args.plugins = installAll ? 'all' : (chosenPlugins.join(','));
  return { args, loaded, discovered, warningsShown };
}

module.exports = { guidedMarketplaceFlowFromScope };
