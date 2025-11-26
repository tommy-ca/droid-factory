"use strict";

const path = require('path');

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
    noHooks: false,
    noSkills: false,
    onlyCommands: false,
    onlyDroids: false,
    onlyHooks: false,
    onlySkills: false,
    commands: undefined,
    droids: undefined,
    hooks: undefined,
    skills: undefined,
    list: false,
    // Marketplace-related
    marketplace: undefined,
    plugins: undefined,
    import: undefined,
    ref: undefined,
    debug: false
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
    else if (a === '--no-hooks') { args.noHooks = true; }
    else if (a === '--no-skills') { args.noSkills = true; }
    else if (a === '--only-commands') { args.onlyCommands = true; }
    else if (a === '--only-droids') { args.onlyDroids = true; }
    else if (a === '--only-hooks') { args.onlyHooks = true; }
    else if (a === '--only-skills') { args.onlySkills = true; }
    else if (a === '--commands' && i + 1 < argv.length) { args.commands = argv[++i]; }
    else if (a === '--droids' && i + 1 < argv.length) { args.droids = argv[++i]; }
    else if (a === '--hooks' && i + 1 < argv.length) { args.hooks = argv[++i]; }
    else if (a === '--skills' && i + 1 < argv.length) { args.skills = argv[++i]; }
    else if (a === '--list') { args.list = true; }
    else if (a === '--verbose') { args.verbose = true; }
    else if (a === '--debug') { args.debug = true; }
    // Marketplace additions
    else if (a === '--marketplace' && i + 1 < argv.length) { args.marketplace = argv[++i]; }
    else if (a === '--plugins' && i + 1 < argv.length) { args.plugins = argv[++i]; }
    else if (a === '--import' && i + 1 < argv.length) { args.import = argv[++i]; }
    else if (a === '--ref' && i + 1 < argv.length) { args.ref = argv[++i]; }
    else if (a === '-h' || a === '--help') { args.help = true; }
    else {
      // ignore unknown arguments for forward compatibility
    }
  }
  return args;
}

function usage(invokedPath) {
  const invoked = path.basename(invokedPath || process.argv[1] || 'droid-factory');
  return `\nUsage: ${invoked} [options]\n\nTargets:\n  --scope personal|project        Install to ~/.factory (default) or <repo>/.factory\n  --path <repo-root>              Required when --scope=project\n\nTemplate selection (defaults: all types):\n  --commands all|name1,name2      Install all or specific commands\n  --droids all|name1,name2        Install all or specific droids\n  --hooks all|name1,name2         Install all or specific hooks\n  --skills all|name1,name2        Install all or specific skills\n  --no-commands                   Skip installing commands\n  --no-droids                     Skip installing droids\n  --no-hooks                      Skip installing hooks\n  --no-skills                     Skip installing skills\n  --only-commands                 Commands only\n  --only-droids                   Droids only\n  --only-hooks                    Hooks only\n  --only-skills                   Skills only\n  --list                          List available templates then exit\n\nMarketplace import:\n  --marketplace <path|url|owner/repo>  Load a Claude Code marketplace\n  --plugins all|name1,name2            Select plugins to install (agents→droids, commands, hooks, skills)\n  --import templates|marketplace       Choose import source non-interactively\n  --ref <branch-or-tag>                GitHub ref for marketplace/plugins (default: main|master)\n\nOther:\n  --force                         Overwrite existing files\n  --yes, -y                       Skip confirmation prompt\n  --dry-run                       Show plan only (no writes)\n  --verbose                       Verbose logging\n  -h, --help                      Show this help\n\nNotes:\n- Names refer to template basenames (e.g. code-review, security-code-reviewer).\n- Defaults install to personal scope → ~/.factory/{commands,droids,hooks,skills}.\n- When --scope=project, pass --path pointing at the repo root.\n`;
}

module.exports = { parseArgs, usage };
