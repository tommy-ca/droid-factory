"use strict";

function dim(str) { return `\x1b[2m${str}\x1b[0m`; }
function green(str) { return `\x1b[32m${str}\x1b[0m`; }
function cyan(str) { return `\x1b[36m${str}\x1b[0m`; }
function bold(str) { return `\x1b[1m${str}\x1b[0m`; }

const symbols = { CHECK: '*', ARROW: '>' };

function plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }

function termWidth() { return (process.stdout && process.stdout.columns) ? process.stdout.columns : 80; }
function truncate(str, max) { if (!str) return ''; if (str.length <= max) return str; return str.slice(0, Math.max(0, max - 1)) + '…'; }

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

function printSummary({ guided, args, basePath, created, overwritten, skipped, customDroidsEnabled, plan }) {
  const { CHECK, ARROW } = symbols;
  if (guided) {
    const allSelected = (args.commands === 'all' && args.droids === 'all');
    if (allSelected) {
      console.log(`${green(CHECK)} ${bold('Step 3/4 — Select commands to install')} ${dim('·')} ${cyan('(skipped)')}`);
      console.log(`${green(CHECK)} ${bold('Step 4/4 — Select droids to install')} ${dim('·')} ${cyan('(skipped)')}`);
    } else {
      if (args.noCommands) console.log(`${green(CHECK)} ${bold('Step 3/4 — Select commands to install')} ${dim('·')} ${cyan('(skipped)')}`);
      if (args.noDroids) console.log(`${green(CHECK)} ${bold('Step 4/4 — Select droids to install')} ${dim('·')} ${cyan('(skipped)')}`);
    }
    console.log(`${ARROW} Installing to: ${cyan(basePath)}`);
    if (customDroidsEnabled) {
      console.log(`${green(CHECK)} Custom droids are enabled in your settings.`);
    } else {
      console.log(`${ARROW} Custom droids need to be enabled in settings.`);
      console.log(`${ARROW} Open /settings → Experimental → Custom Droids, or set enableCustomDroids: true in ~/.factory/settings.json`);
    }
    console.log(`${green(CHECK)} Completed — ${created} created, ${overwritten} overwritten, ${skipped} skipped.`);
    if (!customDroidsEnabled) console.log(`${ARROW} Next: Enable Custom Droids as described above.`);
    console.log(`${ARROW} Next: Restart Droid (Ctrl+C then relaunch) or run /commands and press R to reload.`);
  } else {
    console.log(`${green(CHECK)} Completed — ${created} created, ${overwritten} overwritten, ${skipped} skipped.`);
    console.log(`${ARROW} Next: Restart Droid (Ctrl+C then relaunch) or run /commands and press R to reload.`);
  }
}

function printMarketplacePlan(plan, args, destCommands, destDroids, destHooks, destSkills) {
  console.log('Install plan (marketplace):');
  console.log('  Commands:');
  if (!plan.commands.length) console.log('    (none)');
  else for (const item of plan.commands) console.log(`    - ${item.name} [${item.plugin}]${args.verbose ? ` ← ${item.srcType}` : ''}`);
  console.log('  Droids:');
  if (!plan.droids.length) console.log('    (none)');
  else for (const item of plan.droids) console.log(`    - ${item.name} [${item.plugin}]${args.verbose ? ` ← ${item.srcType}` : ''}`);
  console.log('  Hooks:');
  if (!plan.hooks.length) console.log('    (none)');
  else for (const item of plan.hooks) console.log(`    - ${item.name} [${item.plugin}]${args.verbose ? ` ← ${item.srcType}` : ''}`);
  console.log('  Skills:');
  if (!plan.skills.length) console.log('    (none)');
  else for (const item of plan.skills) console.log(`    - ${item.name} [${item.plugin}]${args.verbose ? ` ← ${item.srcType}` : ''}`);
  if (plan.unresolved?.length) {
    console.log('  Unresolved plugins:');
    for (const u of plan.unresolved) console.log(`    - ${u.plugin}${u.reason ? ` (${u.reason})` : ''}`);
  }
  console.log('\nInstalling to:');
  if (plan.commands.length) console.log(`  ${destCommands}`);
  if (plan.droids.length) console.log(`  ${destDroids}`);
  if (plan.hooks.length) console.log(`  ${destHooks}`);
  if (plan.skills.length) console.log(`  ${destSkills}`);
}

module.exports = {
  colors: { dim, green, cyan, bold },
  symbols,
  helpers: { plural, termWidth, truncate },
  printPlan,
  printSummary,
  printMarketplacePlan,
};
