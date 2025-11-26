"use strict";

const fs = require('fs');
const path = require('path');
const https = require('https');

const githubTreeCache = new Map();
let lastRateLimit = null;

function updateRateLimit(headers) {
  if (!headers) return;
  const limit = headers['x-ratelimit-limit'];
  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];
  if (limit === undefined && remaining === undefined && reset === undefined) return;
  lastRateLimit = {
    limit: limit !== undefined ? Number(limit) : undefined,
    remaining: remaining !== undefined ? Number(remaining) : undefined,
    reset: reset !== undefined ? Number(reset) : undefined,
    fetchedAt: Date.now(),
  };
}

function debugLog(debug, ...args) {
  if (debug) console.log('[debug]', ...args);
}

function isUrl(input) {
  return /^https?:\/\//i.test(input || '');
}

function isOwnerRepoShorthand(input) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input || '');
}

function httpGetText(url, headers = {}, maxRedirects = 5, opts = {}) {
  const debug = !!opts.debug;
  debugLog(debug, 'httpGetText →', url);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'droid-factory', ...headers } }, (res) => {
      debugLog(debug, 'httpGetText status', res.statusCode, url);
      updateRateLimit(res.headers || {});
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        if (location && maxRedirects > 0) {
          const nextUrl = new URL(location, url).toString();
          res.resume(); // discard
          debugLog(debug, 'httpGetText redirect →', nextUrl);
          httpGetText(nextUrl, headers, maxRedirects - 1, opts).then(resolve, reject);
          return;
        }
      }
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          debugLog(debug, 'httpGetText success', url);
          resolve(data);
        } else {
          debugLog(debug, 'httpGetText error', res.statusCode, url);
          const err = new Error(`HTTP ${res.statusCode} for ${url}`);
          err.statusCode = res.statusCode;
          err.url = url;
          err.headers = res.headers;
          reject(err);
        }
      });
    });
    req.on('error', (err) => {
      debugLog(debug, 'httpGetText request error', err?.message || err);
      reject(err);
    });
  });
}

async function httpGetJson(url, headers = {}, opts = {}) {
  const text = await httpGetText(url, headers, undefined, opts);
  return JSON.parse(text);
}

async function githubGetRepoTree(owner, repo, ref, token, opts = {}) {
  const key = `${owner}/${repo}@${ref}`;
  if (githubTreeCache.has(key)) {
    return githubTreeCache.get(key);
  }
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  let json;
  try {
    json = await httpGetJson(url, headers, opts);
  } catch (e) {
    const status = e?.statusCode || e?.status;
    if (status === 404) {
      const err = new Error(`GitHub ref not found: ${owner}/${repo}@${ref}`);
      err.statusCode = 404;
      throw err;
    }
    throw e;
  }
  if (!json || !Array.isArray(json.tree)) {
    const err = new Error(`GitHub tree response malformed for ${owner}/${repo}@${ref}`);
    err.response = json;
    throw err;
  }
  githubTreeCache.set(key, json.tree);
  return json.tree;
}

function readLocalJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function parseGitHubRawUrl(u) {
  try {
    const url = new URL(u);
    if (url.hostname !== 'raw.githubusercontent.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 3) return null;
    const owner = parts[0];
    const repo = parts[1];
    const ref = parts[2];
    const filePath = parts.slice(3).join('/');
    return { owner, repo, ref, filePath };
  } catch { return null; }
}

function parseGitRepoUrl(u) {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    let pathname = url.pathname.replace(/\.git$/i, '');
    // Remove trailing slash
    pathname = pathname.replace(/\/$/, '');
    const parts = pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (host === 'github.com') {
      const owner = parts[0];
      const repo = parts[1];
      if (!owner || !repo) return null;
      return { provider: 'github', owner, repo };
    }
    if (host === 'gitlab.com') {
      if (parts.length < 2) return null;
      const namespacePath = parts.join('/');
      const repo = parts[parts.length - 1];
      return { provider: 'gitlab', namespacePath, repo };
    }
    return null;
  } catch { return null; }
}

async function loadMarketplace(input, ref, opts = {}) {
  const debug = !!opts.debug;
  debugLog(debug, 'loadMarketplace input', input, 'ref', ref);
  // Returns: { json, context }
  // context: { kind: 'local'|'github-raw'|'github-shorthand'|'url', baseDir?, gh?: {owner,repo,ref,basePath} }
  if (!input) throw new Error('No marketplace input provided');

  // Local directory or file
  if (!isUrl(input) && !isOwnerRepoShorthand(input)) {
    let file = input;
    if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
      const candidate = path.join(input, '.claude-plugin', 'marketplace.json');
      if (!fs.existsSync(candidate)) throw new Error(`marketplace.json not found in ${input}`);
      file = candidate;
    }
    debugLog(debug, 'Loading local marketplace file', file);
    const json = readLocalJson(file);
    const baseDir = path.dirname(file);
    return { json, context: { kind: 'local', baseDir } };
  }

  // GitHub shorthand owner/repo
  if (isOwnerRepoShorthand(input)) {
    const [owner, repo] = input.split('/');
    const refsToTry = ref ? [ref] : ['main', 'master'];
    let lastErr = null;
    for (const r of refsToTry) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${r}/.claude-plugin/marketplace.json`;
      debugLog(debug, 'Attempt GitHub shorthand fetch', rawUrl);
      try {
        const text = await httpGetText(rawUrl, undefined, undefined, { debug });
        const json = JSON.parse(text);
        return { json, context: { kind: 'github', gh: { owner, repo, ref: r, basePath: '' } } };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Failed to load marketplace from GitHub shorthand');
  }

  // URL
  if (isUrl(input)) {
    const ghParsed = parseGitHubRawUrl(input);
    if (ghParsed) {
      debugLog(debug, 'Detected GitHub raw URL', input, ghParsed);
      const text = await httpGetText(input, undefined, undefined, { debug });
      const json = JSON.parse(text);
      // base path is directory of filePath
      const basePath = ghParsed.filePath ? path.posix.dirname(ghParsed.filePath) : '';
      return { json, context: { kind: 'github', gh: { owner: ghParsed.owner, repo: ghParsed.repo, ref: ghParsed.ref, basePath } } };
    }
    const gitRepo = parseGitRepoUrl(input);
    if (gitRepo && gitRepo.provider === 'github') {
      const refsToTry = ref ? [ref] : ['main', 'master'];
      let lastErr = null;
      for (const r of refsToTry) {
        const rawUrl = `https://raw.githubusercontent.com/${gitRepo.owner}/${gitRepo.repo}/${r}/.claude-plugin/marketplace.json`;
        debugLog(debug, 'Attempt GitHub git URL fetch', rawUrl);
        try {
          const text = await httpGetText(rawUrl, undefined, undefined, { debug });
          const json = JSON.parse(text);
          return { json, context: { kind: 'github', gh: { owner: gitRepo.owner, repo: gitRepo.repo, ref: r, basePath: '' } } };
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('Failed to load marketplace from GitHub git URL');
    }
    if (gitRepo && gitRepo.provider === 'gitlab') {
      const refsToTry = [ref, 'main', 'master'].filter(Boolean);
      let lastErr = null;
      for (const r of refsToTry) {
        const rawUrl = `https://gitlab.com/${gitRepo.namespacePath}/-/raw/${encodeURIComponent(r)}/.claude-plugin/marketplace.json`;
        debugLog(debug, 'Attempt GitLab git URL fetch', rawUrl);
        try {
          const text = await httpGetText(rawUrl, undefined, undefined, { debug });
          const json = JSON.parse(text);
          return { json, context: { kind: 'gitlab', gl: { namespacePath: gitRepo.namespacePath, repo: gitRepo.repo, ref: r, basePath: '' } } };
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('Failed to load marketplace from GitLab git URL');
    }
    // Generic URL to marketplace.json
    const text = await httpGetText(input, undefined, undefined, { debug });
    const json = JSON.parse(text);
    return { json, context: { kind: 'url', baseUrl: input.replace(/\/marketplace\.json$/,'') } };
  }

  throw new Error('Unsupported marketplace input');
}

function normalizePlugins(json) {
  const plugins = Array.isArray(json?.plugins) ? json.plugins : [];
  return plugins.map((p) => ({
    name: p.name,
    description: p.description || '',
    version: p.version || '',
    author: p.author || {},
    category: p.category || p.tags || '',
    keywords: p.keywords || p.tags || [],
    license: p.license || '',
    homepage: p.homepage || '',
    repository: p.repository || '',
    strict: p.strict !== undefined ? !!p.strict : true,
    pluginRoot: json.pluginRoot || json.metadata?.pluginRoot || '',
    source: p.source,
    overrides: { commands: p.commands, agents: p.agents, hooks: p.hooks, mcpServers: p.mcpServers }
  })).filter((p) => !!p.name);
}

function resolvePluginSource(plugin, context) {
  // Returns { kind, localDir?, github?, reason?, overrides }
  const overrides = plugin.overrides || {};
  const src = plugin.source;
  const pluginRoot = plugin.pluginRoot || '';
  if (typeof src === 'string') {
    // Relative path
    if (context.kind === 'local') {
      const base = path.resolve(path.join(context.baseDir, pluginRoot || ''));
      return { kind: 'local', localDir: path.resolve(base, src), overrides };
    }
    if (context.kind === 'github' && context.gh) {
      const basePath = path.posix.join(context.gh.basePath || '', pluginRoot || '');
      const full = path.posix.join(basePath, src);
      return { kind: 'github', github: { ...context.gh, path: full }, overrides };
    }
    if (context.kind === 'gitlab' && context.gl) {
      const basePath = path.posix.join(context.gl.basePath || '', pluginRoot || '');
      const full = path.posix.join(basePath, src);
      return { kind: 'gitlab', gitlab: { ...context.gl, path: full }, overrides };
    }
    // Generic URL base not supported for directory enumeration
    return { kind: 'unsupported', reason: 'Non-GitHub remote source path', overrides };
  }
  if (src && typeof src === 'object') {
    const type = (src.source || src.type || '').toLowerCase();
    if (type === 'github') {
      const repo = src.repo || src.repository;
      if (!repo) return { kind: 'unsupported', reason: 'Missing GitHub repo', overrides };
      const [owner, repoName] = repo.split('/');
      const ref = src.ref || context.gh?.ref || 'main';
      const basePath = src.path || '';
      return { kind: 'github', github: { owner, repo: repoName, ref, path: basePath }, overrides };
    }
    if (type === 'git' || type === 'url') {
      const url = src.url || src.href || '';
      const repo = parseGitRepoUrl(url);
      if (repo && repo.provider === 'github') {
        const ref = src.ref || context.gh?.ref || 'main';
        const basePath = src.path || '';
        return { kind: 'github', github: { owner: repo.owner, repo: repo.repo, ref, path: basePath }, overrides };
      }
      if (repo && repo.provider === 'gitlab') {
        const ref = src.ref || context.gl?.ref || 'main';
        const basePath = src.path || '';
        return { kind: 'gitlab', gitlab: { namespacePath: repo.namespacePath, repo: repo.repo, ref, path: basePath }, overrides };
      }
      return { kind: 'unsupported', reason: 'Unsupported git/url provider', overrides };
    }
  }
  return { kind: 'unsupported', reason: 'Unknown source type', overrides };
}

function listMarkdownFilesLocal(dir) {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(dir, f))
      .sort();
  } catch { return []; }
}

function listFilesLocal(dir) {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir)
      .map((f) => path.join(dir, f))
      .filter((p) => fs.existsSync(p) && fs.statSync(p).isFile())
      .sort();
  } catch { return []; }
}

function listSkillsLocal(dir) {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
        return fs.existsSync(skillMdPath);
      })
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch { return []; }
}

async function githubListDir(owner, repo, ref, repoPath, token, opts = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const encPath = encodeURIComponent(repoPath).replace(/%2F/g, '/');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encPath}?ref=${encodeURIComponent(ref)}`;
  const result = await httpGetJson(url, headers, opts);
  return result;
}

function toRawUrl(owner, repo, ref, repoPath) {
  const safe = repoPath.replace(/^\//, '');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${safe}`;
}

async function gitlabListDir(namespacePath, ref, repoPath, opts = {}) {
  // GitLab repository tree API (public repos)
  const project = encodeURIComponent(namespacePath);
  const encPath = encodeURIComponent(repoPath);
  const url = `https://gitlab.com/api/v4/projects/${project}/repository/tree?path=${encPath}&ref=${encodeURIComponent(ref)}&per_page=100`;
  const result = await httpGetJson(url, undefined, opts);
  return result;
}

function toGitlabRawUrl(namespacePath, ref, repoPath) {
  const safe = repoPath.replace(/^\//, '');
  return `https://gitlab.com/${namespacePath}/-/raw/${ref}/${safe}`;
}

async function scanPluginLocal(localDir, overrides, opts = {}) {
  const debug = !!opts.debug;
  debugLog(debug, 'scanPluginLocal', localDir);
  const errors = [];
  if (!fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
    errors.push(`Local source not found: ${localDir}`);
    debugLog(debug, 'scanPluginLocal missing directory', localDir);
    return { commands: [], agents: [], hooks: [], skills: [], errors };
  }
  const commandsDir = overrides?.commands && typeof overrides.commands === 'string' ? path.resolve(localDir, overrides.commands) : path.join(localDir, 'commands');
  const agentsDir = overrides?.agents && typeof overrides.agents === 'string' ? path.resolve(localDir, overrides.agents) : path.join(localDir, 'agents');
  const hooksDir = overrides?.hooks && typeof overrides.hooks === 'string' ? path.resolve(localDir, overrides.hooks) : path.join(localDir, 'hooks');
  const skillsDir = overrides?.skills && typeof overrides.skills === 'string' ? path.resolve(localDir, overrides.skills) : path.join(localDir, 'skills');

  const commands = Array.isArray(overrides?.commands)
    ? overrides.commands.map((p) => path.resolve(localDir, p)).filter((p) => p.endsWith('.md') && fs.existsSync(p))
    : listMarkdownFilesLocal(commandsDir);
  const agents = Array.isArray(overrides?.agents)
    ? overrides.agents.map((p) => path.resolve(localDir, p)).filter((p) => p.endsWith('.md') && fs.existsSync(p))
    : listMarkdownFilesLocal(agentsDir);
  const hooks = Array.isArray(overrides?.hooks)
    ? overrides.hooks.map((p) => path.resolve(localDir, p)).filter((p) => fs.existsSync(p) && fs.statSync(p).isFile())
    : listFilesLocal(hooksDir);
  const skills = Array.isArray(overrides?.skills)
    ? overrides.skills.map((p) => path.resolve(localDir, p)).filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory())
    : listSkillsLocal(skillsDir);

  debugLog(debug, 'scanPluginLocal results', { commands, agents, hooks, skills });

  return { commands, agents, hooks, skills, errors };
}

async function scanPluginGithub(gh, overrides, opts = {}) {
  const debug = !!opts.debug;
  debugLog(debug, 'scanPluginGithub', gh);
  const token = opts.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  // Build candidate paths
  const base = gh.path || '';
  const commandsPath = typeof overrides?.commands === 'string' ? path.posix.join(base, overrides.commands) : path.posix.join(base, 'commands');
  const agentsPath = typeof overrides?.agents === 'string' ? path.posix.join(base, overrides.agents) : path.posix.join(base, 'agents');
  const hooksPath = typeof overrides?.hooks === 'string' ? path.posix.join(base, overrides.hooks) : path.posix.join(base, 'hooks');
  const skillsPath = typeof overrides?.skills === 'string' ? path.posix.join(base, overrides.skills) : path.posix.join(base, 'skills');

  const errors = [];
  let tree = null;
  let treeFailed = false;
  try {
    tree = await githubGetRepoTree(gh.owner, gh.repo, gh.ref, token, opts);
    debugLog(debug, `Loaded GitHub tree for ${gh.owner}/${gh.repo}@${gh.ref}`, { size: tree.length });
  } catch (e) {
    treeFailed = true;
    debugLog(debug, `GitHub tree fetch failed for ${gh.owner}/${gh.repo}@${gh.ref}`, e?.message || e);
  }

  const isMarkdown = (repoPath) => /\.md$/i.test(repoPath);

  function listFromTree(pathInRepo, filterFn = isMarkdown) {
    if (!tree || !Array.isArray(tree)) return null;
    const normalized = pathInRepo.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '');
    if (!normalized) return [];
    const prefix = normalized + '/';
    const results = [];
    for (const entry of tree) {
      if (!entry || entry.type !== 'blob' || typeof entry.path !== 'string') continue;
      if (!entry.path.startsWith(prefix)) continue;
      const remainder = entry.path.slice(prefix.length);
      if (!remainder || remainder.includes('/')) continue; // direct children only
      if (filterFn && !filterFn(entry.path)) continue;
      results.push(toRawUrl(gh.owner, gh.repo, gh.ref, entry.path));
    }
    return results;
  }

  async function listViaApi(pathInRepo, label, filterFn = isMarkdown) {
    try {
      const entries = await githubListDir(gh.owner, gh.repo, gh.ref, pathInRepo, token, opts);
      if (!Array.isArray(entries)) {
        const msg = `GitHub API unexpected response for ${label}`;
        errors.push(msg);
        debugLog(debug, msg);
        return [];
      }
      return entries
        .filter((e) => e && e.type === 'file' && (!filterFn || filterFn(e.path || e.download_url || e.name)))
        .map((e) => e.download_url || toRawUrl(gh.owner, gh.repo, gh.ref, path.posix.join(pathInRepo, e.name)));
    } catch (e) {
      if (e && e.statusCode === 404) {
        debugLog(debug, `GitHub path not found (${label}) — treating as empty`);
        return [];
      }
      const msg = `GitHub API error (${label}): ${e?.message || e}`;
      errors.push(msg);
      debugLog(debug, msg);
      return [];
    }
  }

  async function resolveSection(pathInRepo, overrideValue, label, filterFn = isMarkdown) {
    if (Array.isArray(overrideValue)) {
      return overrideValue
        .map((p) => path.posix.join(base, p))
        .filter((repoPath) => !filterFn || filterFn(repoPath))
        .map((repoPath) => toRawUrl(gh.owner, gh.repo, gh.ref, repoPath));
    }
    let urls = listFromTree(pathInRepo, filterFn);
    if (urls === null || (urls && urls.length === 0 && treeFailed)) {
      urls = await listViaApi(pathInRepo, label, filterFn);
    }
    if (urls === null) urls = await listViaApi(pathInRepo, label, filterFn);
    return urls || [];
  }

  // Skills require special handling - need to find directories with SKILL.md
  function listSkillsFromTree(pathInRepo) {
    if (!tree || !Array.isArray(tree)) return null;
    const normalized = pathInRepo.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '');
    if (!normalized) return [];
    const prefix = normalized + '/';
    const skillDirs = new Set();

    for (const entry of tree) {
      if (!entry || typeof entry.path !== 'string') continue;
      if (!entry.path.startsWith(prefix)) continue;
      const remainder = entry.path.slice(prefix.length);
      const parts = remainder.split('/');
      if (parts.length >= 2 && parts[1] === 'SKILL.md') {
        skillDirs.add(parts[0]);
      }
    }

    return Array.from(skillDirs).sort().map(dir => toRawUrl(gh.owner, gh.repo, gh.ref, `${prefix}${dir}`));
  }

  async function resolveSkills(pathInRepo, overrideValue, label) {
    if (Array.isArray(overrideValue)) {
      return overrideValue
        .map((p) => path.posix.join(base, p))
        .map((repoPath) => toRawUrl(gh.owner, gh.repo, gh.ref, repoPath));
    }
    let urls = listSkillsFromTree(pathInRepo);
    if (urls === null || (urls && urls.length === 0 && treeFailed)) {
      // Fallback to API approach
      try {
        const entries = await githubListDir(gh.owner, gh.repo, gh.ref, pathInRepo, token, opts);
        if (Array.isArray(entries)) {
          const skillDirs = [];
          for (const e of entries) {
            if (e && e.type === 'dir') {
              const skillMdPath = path.posix.join(pathInRepo, e.name, 'SKILL.md');
              try {
                await githubListDir(gh.owner, gh.repo, gh.ref, skillMdPath, token, opts);
                skillDirs.push(toRawUrl(gh.owner, gh.repo, gh.ref, path.posix.join(pathInRepo, e.name)));
              } catch { /* not a skill */ }
            }
          }
          urls = skillDirs;
        }
      } catch (e) {
        if (e && e.statusCode === 404) {
          debugLog(debug, `GitHub path not found (${label}) — treating as empty`);
          return [];
        }
        const msg = `GitHub API error (${label}): ${e?.message || e}`;
        errors.push(msg);
        debugLog(debug, msg);
        return [];
      }
    }
    return urls || [];
  }

  const commands = await resolveSection(commandsPath, overrides?.commands, `${gh.repo}/${commandsPath}`);
  const agents = await resolveSection(agentsPath, overrides?.agents, `${gh.repo}/${agentsPath}`);
  const hooks = await resolveSection(hooksPath, overrides?.hooks, `${gh.repo}/${hooksPath}`, null);
  const skills = await resolveSkills(skillsPath, overrides?.skills, `${gh.repo}/${skillsPath}`);

  debugLog(debug, 'scanPluginGithub discovered', { commands, agents, hooks, skills, errors });
  return { commands, agents, hooks, skills, errors };
}

async function scanPluginGitlab(gl, overrides, opts = {}) {
  const debug = !!opts.debug;
  debugLog(debug, 'scanPluginGitlab', gl);
  const base = gl.path || '';
  const commandsPath = typeof overrides?.commands === 'string' ? path.posix.join(base, overrides.commands) : path.posix.join(base, 'commands');
  const agentsPath = typeof overrides?.agents === 'string' ? path.posix.join(base, overrides.agents) : path.posix.join(base, 'agents');
  const hooksPath = typeof overrides?.hooks === 'string' ? path.posix.join(base, overrides.hooks) : path.posix.join(base, 'hooks');
  const skillsPath = typeof overrides?.skills === 'string' ? path.posix.join(base, overrides.skills) : path.posix.join(base, 'skills');

  const errors = [];

  async function resolveSection(pathInRepo, overrideValue, label, filterFn = (name) => /\.md$/i.test(name)) {
    if (Array.isArray(overrideValue)) {
      return overrideValue
        .map((p) => path.posix.join(base, p))
        .filter((repoPath) => !filterFn || filterFn(repoPath))
        .map((repoPath) => toGitlabRawUrl(gl.namespacePath, gl.ref, repoPath));
    }
    try {
      const entries = await gitlabListDir(gl.namespacePath, gl.ref, pathInRepo, opts);
      if (!Array.isArray(entries)) {
        const msg = `GitLab API unexpected response for ${label}`;
        errors.push(msg);
        debugLog(debug, msg);
        return [];
      }
      return entries
        .filter((e) => e && e.type === 'blob' && (!filterFn || filterFn(e.path || e.name)))
        .map((e) => toGitlabRawUrl(gl.namespacePath, gl.ref, e.path || (pathInRepo + '/' + e.name)));
    } catch (e) {
      if (e && e.statusCode === 404) {
        debugLog(debug, `GitLab path not found (${label}) — treating as empty`);
        return [];
      }
      const msg = `GitLab API error (${label}): ${e?.message || e}`;
      errors.push(msg);
      debugLog(debug, msg);
      return [];
    }
  }

  async function resolveSkills(pathInRepo, overrideValue, label) {
    if (Array.isArray(overrideValue)) {
      return overrideValue
        .map((p) => path.posix.join(base, p))
        .map((repoPath) => toGitlabRawUrl(gl.namespacePath, gl.ref, repoPath));
    }
    try {
      const entries = await gitlabListDir(gl.namespacePath, gl.ref, pathInRepo, opts);
      if (!Array.isArray(entries)) {
        const msg = `GitLab API unexpected response for ${label}`;
        errors.push(msg);
        debugLog(debug, msg);
        return [];
      }
      const skillDirs = [];
      for (const e of entries) {
        if (e && e.type === 'tree') {
          const skillMdPath = path.posix.join(pathInRepo, e.name, 'SKILL.md');
          try {
            await gitlabListDir(gl.namespacePath, gl.ref, skillMdPath, opts);
            skillDirs.push(toGitlabRawUrl(gl.namespacePath, gl.ref, path.posix.join(pathInRepo, e.name)));
          } catch { /* not a skill */ }
        }
      }
      return skillDirs;
    } catch (e) {
      if (e && e.statusCode === 404) {
        debugLog(debug, `GitLab path not found (${label}) — treating as empty`);
        return [];
      }
      const msg = `GitLab API error (${label}): ${e?.message || e}`;
      errors.push(msg);
      debugLog(debug, msg);
      return [];
    }
  }

  const commands = await resolveSection(commandsPath, overrides?.commands, `${gl.repo}/${commandsPath}`);
  const agents = await resolveSection(agentsPath, overrides?.agents, `${gl.repo}/${agentsPath}`);
  const hooks = await resolveSection(hooksPath, overrides?.hooks, `${gl.repo}/${hooksPath}`, null);
  const skills = await resolveSkills(skillsPath, overrides?.skills, `${gl.repo}/${skillsPath}`);

  debugLog(debug, 'scanPluginGitlab discovered', { commands, agents, hooks, skills, errors });
  return { commands, agents, hooks, skills, errors };
}

async function discoverPlugins(marketplaceJson, context, opts = {}) {
  const debug = !!opts.debug;
  debugLog(debug, 'discoverPlugins start', { contextKind: context?.kind });
  const normalized = normalizePlugins(marketplaceJson);
  const results = [];
  for (const p of normalized) {
    const resolved = resolvePluginSource(p, context);
    debugLog(debug, `Plugin ${p.name} resolved`, resolved);
    let scan = { commands: [], agents: [], hooks: [], errors: [] };
    try {
      if (resolved.kind === 'local') {
        scan = await scanPluginLocal(resolved.localDir, resolved.overrides, opts);
      } else if (resolved.kind === 'github') {
        scan = await scanPluginGithub(resolved.github, resolved.overrides, opts);
      } else if (resolved.kind === 'gitlab') {
        scan = await scanPluginGitlab(resolved.gitlab, resolved.overrides, opts);
      }
    } catch (e) {
      debugLog(debug, `Plugin ${p.name} scan error`, e?.message || e);
    }
    debugLog(debug, `Plugin ${p.name} discovered counts`, { commands: scan.commands.length, agents: scan.agents.length, hooks: scan.hooks?.length || 0, skills: scan.skills?.length || 0, errors: scan.errors?.length || 0 });
    results.push({
      name: p.name,
      description: p.description,
      resolved,
      commands: scan.commands,
      agents: scan.agents,
      hooks: scan.hooks,
      skills: scan.skills,
      errors: scan.errors || [],
    });
  }
  return results;
}

function basenameNoExt(p) { return path.basename(p).replace(/\.md$/i, ''); }

module.exports = {
  loadMarketplace,
  discoverPlugins,
  basenameNoExt,
  httpGetText,
  getLastRateLimit: () => lastRateLimit,
};
