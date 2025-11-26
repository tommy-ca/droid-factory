"use strict";

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

function parseGitHubRawUrl(u) {
  try {
    const url = new URL(u);
    if (url.hostname !== 'raw.githubusercontent.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 4) return null;
    const owner = parts[0];
    const repo = parts[1];
    const ref = parts[2];
    const basePath = parts.slice(3).join('/');
    return { owner, repo, ref, basePath };
  } catch { return null; }
}

function listBasenames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

function listSkills(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
      return fs.existsSync(skillMdPath);
    })
    .map((entry) => entry.name)
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

function copyDirectory(src, dest, force) {
  if (fs.existsSync(dest) && !force) return 'skipped';
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true, force });
  return 'written';
}

async function downloadDirectory(src, dest, force, opts = {}) {
  const parsed = parseGitHubRawUrl(src);
  if (!parsed) return 'skipped';
  if (fs.existsSync(dest) && !force) return 'skipped';
  ensureDir(dest);
  const token = opts.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = token
    ? { 'User-Agent': 'droid-factory', Authorization: `Bearer ${token}` }
    : { 'User-Agent': 'droid-factory' };
  const apiBase = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(parsed.basePath).replace(/%2F/g,'/')}`;

  const withRef = (urlStr) => {
    const u = new URL(urlStr);
    if (parsed.ref && !u.searchParams.has('ref')) u.searchParams.set('ref', parsed.ref);
    return u.toString();
  };

  async function fetchJson(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers }, (res) => {
        let data = '';
        res.on('data', (d) => data += d);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          } else {
            const err = new Error(`HTTP ${res.statusCode} for ${url}`);
            err.statusCode = res.statusCode;
            reject(err);
          }
        });
      });
      req.on('error', reject);
    });
  }

  async function walk(apiUrl, relativePath) {
    const entries = await fetchJson(withRef(apiUrl));
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (!e || !e.type || !e.path) continue;
      const rel = e.path.replace(parsed.basePath, '').replace(/^\//, '');
      const destPath = path.join(dest, rel);
      if (e.type === 'file') {
        await downloadToFile(e.download_url || e.url, destPath, force);
      } else if (e.type === 'dir') {
        await walk(withRef(e.url), rel);
      }
    }
  }

  try {
    await walk(apiBase, '');
    return 'written';
  } catch (e) {
    if (opts.debug) console.log('[debug] downloadDirectory error', e?.message || e);
    return 'skipped';
  }
}

function downloadToFile(url, dest, force) {
  if (fs.existsSync(dest) && !force) return Promise.resolve('skipped');
  ensureDir(path.dirname(dest));
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'droid-factory' } }, (res) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve('written')));
      } else {
        file.close(() => fs.unlink(dest, () => resolve('skipped')));
      }
    });
    req.on('error', (err) => { file.close(() => fs.unlink(dest, () => reject(err))); });
  });
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
  listSkills,
  ensureDir,
  copyFile,
  copyDirectory,
   downloadDirectory,
  getTemplateDescription,
  readCustomDroidsSetting,
  downloadToFile,
};
