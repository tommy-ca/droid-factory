"use strict";

const path = require('path');

function flattenName(src, kind) {
  // Normalize separators to posix for consistent parsing
  const s = (src || '').replace(/\\/g, '/').replace(/\/+/, '/');
  const needle = `/${kind}/`;
  const idx = s.indexOf(needle);
  let rel = '';
  if (idx !== -1) {
    rel = s.slice(idx + needle.length).replace(/^\//, '').replace(/\/$/, '');
  }
  if (!rel) {
    rel = path.basename(s).replace(/\.md$/i, '').replace(/\/$/, '');
  }
  // Drop extension if present (for files)
  rel = rel.replace(/\.md$/i, '');
  // Replace any remaining slashes with double underscores to keep hierarchy info flat
  return rel.split('/').filter(Boolean).join('__');
}

function computeMarketplacePlan({ selectedPlugins, discovered, destCommandsDir, destDroidsDir, destHooksDir, destSkillsDir }) {
  const selected = (selectedPlugins === 'all')
    ? discovered
    : discovered.filter((p) => selectedPlugins.includes(p.name));

  const unresolved = [];
  const commands = [];
  const droids = [];
  const hooks = [];
  const skills = [];

  for (const p of selected) {
    const res = p.resolved || { kind: 'unsupported', reason: 'Unknown' };
    const errors = Array.isArray(p.errors) ? p.errors.filter(Boolean) : [];
    const hasCommands = Array.isArray(p.commands) && p.commands.length > 0;
    const hasAgents = Array.isArray(p.agents) && p.agents.length > 0;
    const hasHooks = Array.isArray(p.hooks) && p.hooks.length > 0;
    const hasSkills = Array.isArray(p.skills) && p.skills.length > 0;

    if (errors.length) {
      for (const err of errors) {
        unresolved.push({ plugin: p.name, reason: err });
      }
    }

    if (!hasCommands && !hasAgents && !hasHooks && !hasSkills) {
      if (!errors.length) {
        unresolved.push({ plugin: p.name, reason: res.reason || 'No components found' });
      }
      continue;
    }

    // Commands
    for (const c of (p.commands || [])) {
      const isUrl = /^https?:\/\//i.test(c);
      const name = flattenName(c, 'commands');
      const dest = path.join(destCommandsDir, `${name}.md`);
      commands.push({ plugin: p.name, name, src: c, srcType: isUrl ? 'remote' : 'local', dest });
    }

    // Agents → droids
    for (const a of (p.agents || [])) {
      const isUrl = /^https?:\/\//i.test(a);
      const name = flattenName(a, 'agents');
      const dest = path.join(destDroidsDir, `${name}.md`);
      droids.push({ plugin: p.name, name, src: a, srcType: isUrl ? 'remote' : 'local', dest });
    }

    // Hooks
    for (const h of (p.hooks || [])) {
      const isUrl = /^https?:\/\//i.test(h);
      const name = flattenName(h, 'hooks');
      const dest = path.join(destHooksDir, `${name}.md`);
      hooks.push({ plugin: p.name, name, src: h, srcType: isUrl ? 'remote' : 'local', dest });
    }

    // Skills (allow remote via download; still copy local directories when provided)
    for (const s of (p.skills || [])) {
      const isUrl = /^https?:\/\//i.test(s);
      const name = flattenName(s, 'skills');
      const dest = path.join(destSkillsDir, name);
      const srcType = isUrl ? 'remote' : 'local';
      skills.push({ plugin: p.name, name, src: s, srcType, dest, isSkill: true });
    }
  }

  return { commands, droids, hooks, skills, unresolved };
}

module.exports = { computeMarketplacePlan };
