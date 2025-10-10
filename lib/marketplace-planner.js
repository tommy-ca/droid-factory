"use strict";

const path = require('path');

function computeMarketplacePlan({ selectedPlugins, discovered, destCommandsDir, destDroidsDir }) {
  const selected = (selectedPlugins === 'all')
    ? discovered
    : discovered.filter((p) => selectedPlugins.includes(p.name));

  const unresolved = [];
  const commands = [];
  const droids = [];

  for (const p of selected) {
    const res = p.resolved || { kind: 'unsupported', reason: 'Unknown' };
    const errors = Array.isArray(p.errors) ? p.errors.filter(Boolean) : [];
    const hasCommands = Array.isArray(p.commands) && p.commands.length > 0;
    const hasAgents = Array.isArray(p.agents) && p.agents.length > 0;
    const hookCount = Array.isArray(p.hooks) ? p.hooks.length : 0;

    if (errors.length) {
      for (const err of errors) {
        unresolved.push({ plugin: p.name, reason: err });
      }
    }

    if (hookCount) {
      const label = hookCount === 1 ? 'hook' : 'hooks';
      unresolved.push({ plugin: p.name, reason: `${hookCount} ${label} not installed (unsupported)` });
    }

    if (!hasCommands && !hasAgents) {
      if (!errors.length && !hookCount) {
        unresolved.push({ plugin: p.name, reason: res.reason || 'No components found' });
      }
      continue;
    }

    // Commands
    for (const c of (p.commands || [])) {
      const isUrl = /^https?:\/\//i.test(c);
      const name = isUrl ? path.basename(c).replace(/\.md$/i, '') : path.basename(c).replace(/\.md$/i, '');
      const dest = path.join(destCommandsDir, `${name}.md`);
      commands.push({ plugin: p.name, name, src: c, srcType: isUrl ? 'remote' : 'local', dest });
    }

    // Agents → droids
    for (const a of (p.agents || [])) {
      const isUrl = /^https?:\/\//i.test(a);
      const name = isUrl ? path.basename(a).replace(/\.md$/i, '') : path.basename(a).replace(/\.md$/i, '');
      const dest = path.join(destDroidsDir, `${name}.md`);
      droids.push({ plugin: p.name, name, src: a, srcType: isUrl ? 'remote' : 'local', dest });
    }
  }

  return { commands, droids, unresolved };
}

module.exports = { computeMarketplacePlan };
