"use strict";

const fs = require('fs');
const os = require('os');
const path = require('path');

function listBasenames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest, force) {
  if (fs.existsSync(dest) && !force) return 'skipped';
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return 'written';
}

function getTemplateDescription(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.startsWith('---')) return null;
    const end = content.indexOf('\n---', 3);
    if (end === -1) return null;
    const frontMatter = content.slice(3, end).split('\n');
    for (const rawLine of frontMatter) {
      const line = rawLine.trim();
      if (line.toLowerCase().startsWith('description:')) {
        const value = line.slice('description:'.length).trim();
        return value.replace(/^['"]|['"]$/g, '');
      }
    }
  } catch { /* ignore */ }
  return null;
}

function readCustomDroidsSetting() {
  const settingsPath = path.join(os.homedir(), '.factory', 'settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\n)\s*\/\/.*?(?=\n|$)/g, '$1');
    const data = JSON.parse(stripped);
    return { enabled: data?.enableCustomDroids === true, path: settingsPath };
  } catch (err) {
    if (err.code === 'ENOENT') return { enabled: false, missing: true, path: settingsPath };
    return { enabled: false, error: err, path: settingsPath };
  }
}

module.exports = {
  listBasenames,
  ensureDir,
  copyFile,
  getTemplateDescription,
  readCustomDroidsSetting,
};
