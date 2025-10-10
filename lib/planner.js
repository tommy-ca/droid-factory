"use strict";

const fs = require('fs');
const path = require('path');
const { getTemplateDescription } = require('./fs-utils');

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

function computePlan({ selectedCommands, selectedDroids, templateCommandsDir, templateDroidsDir, destCommandsDir, destDroidsDir }) {
  const commands = selectedCommands.map((name) => {
    const src = path.join(templateCommandsDir, `${name}.md`);
    const dest = path.join(destCommandsDir, `${name}.md`);
    return {
      name,
      src,
      dest,
      description: getTemplateDescription(src),
      exists: fs.existsSync(dest),
    };
  });

  const droids = selectedDroids.map((name) => {
    const src = path.join(templateDroidsDir, `${name}.md`);
    const dest = path.join(destDroidsDir, `${name}.md`);
    return {
      name,
      src,
      dest,
      description: getTemplateDescription(src),
      exists: fs.existsSync(dest),
    };
  });

  return { commands, droids };
}

module.exports = { resolveSelection, computePlan };
