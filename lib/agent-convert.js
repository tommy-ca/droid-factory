"use strict";

const matter = require('gray-matter');
// no extra YAML deps; we build minimal frontmatter manually

function toArray(val) {
  if (!val && val !== 0) return null;
  if (Array.isArray(val)) return [...new Set(val.map(String))];
  const parts = String(val).split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? [...new Set(parts)] : null;
}

function convertAgentMarkdownToDroid(mdText, { fallbackName } = {}) {
  let parsed;
  let src = {};
  let body = '';
  try {
    parsed = matter(mdText || '', { language: 'yaml' });
    src = parsed.data || {};
    body = parsed.content || '';
  } catch (e) {
    // Fallback: salvage minimal fields from malformed frontmatter
    const text = String(mdText || '');
    const fmStart = text.indexOf('---');
    let fmEnd = -1;
    if (fmStart === 0) {
      fmEnd = text.indexOf('\n---', 3);
    }
    if (fmStart === 0 && fmEnd !== -1) {
      const fmBlock = text.slice(3, fmEnd).split(/\r?\n/);
      // Extract simple key: value on a single line
      for (const line of fmBlock) {
        const m = /^([A-Za-z0-9_\-]+):\s*(.*)$/.exec(line.trim());
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2];
        if (key === 'name' && !src.name) src.name = val;
        else if (key === 'description' && !src.description) src.description = val;
        else if (key === 'tools' && !src.tools) src.tools = val;
        // ignore model and others in fallback
      }
      // Preserve meaningful lines (example-like keys allowed), drop other yaml-ish keys (color, etc.)
      const filtered = fmBlock.filter((line) => {
        const ln = (line || '').trim();
        if (/^\s*(name|description|tools|model|color|createdat|updatedat|author|homepage|category|keywords|license|version):\s*/i.test(ln)) return false;
        const yamlish = /^[A-Za-z0-9_\-]+:\s*/.test(ln);
        const allowed = /^(context|user|assistant|commentary):\s*/i.test(ln);
        if (yamlish && !allowed) return false;
        return true;
      });
      // If examples were embedded in frontmatter, capture them to augment description
      const fmRaw = fmBlock.join('\n');
      const exampleMatches = fmRaw.match(/<example>[\s\S]*?<\/example>/gi) || [];
      if (exampleMatches.length) {
        const examplesInline = exampleMatches.join(' ').replace(/\s+/g, ' ').trim();
        if (src.description) src.description = String(src.description) + ' ' + examplesInline;
        else src.description = examplesInline;
      }
      body = filtered.join('\n') + '\n' + text.slice(fmEnd + 4);
    } else {
      body = text;
    }
  }

  const toolsList = toArray(src.tools);
  // Normalize description to single-line and strip escaped newlines/tags
  function sanitizeDescription(input) {
    if (typeof input !== 'string') return undefined;
    let s = String(input);
    // Convert literal escape sequences first
    s = s.replace(/\\[nrt]/gi, ' ');
    // Normalize common HTML line/paragraph breaks but preserve XML-ish tags like <example>
    s = s.replace(/<br\s*\/?>/gi, ' ');
    s = s.replace(/<\/?:?p\b[^>]*>/gi, ' ');
    // Collapse actual newlines and excessive whitespace
    s = s.replace(/\s*\n\s*/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    // Replace display-style role labels like "Context:" "Assistant:" etc. with hyphen form to avoid YAML quoting while keeping text clean
    // Avoid URLs ("://") and emoji/colon code; only replace when colon follows an alnum and a space
    s = s.replace(/([A-Za-z0-9])\s*:\s+(?!\/)/g, '$1 - ');
    return s || undefined;
  }

  let description = sanitizeDescription(src.description);

  const name = src.name || fallbackName || '';
  const tools = Array.isArray(toolsList) && toolsList.length ? toolsList : null;
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  function isPlainYamlSafe(s) {
    if (typeof s !== 'string') return false;
    if (!s.length) return true;
    if (/[\r\n]/.test(s)) return false;
    if (/^\s/.test(s)) return false;
    if (/\s$/.test(s)) return false;
    if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s)) return false;
    // allow colon+space inside plain scalars; YAML parsers accept this in values
    if (/#/.test(s)) return false; // '#' would start a comment if unquoted
    return true;
  }
  const lines = [];
  lines.push('---');
  lines.push(`name: ${name}`);
  if (typeof description === 'string' && description.length) {
    // Prefer plain scalar when possible; minimally transform to avoid YAML pitfalls
    let plainCandidate = description.indexOf('#') !== -1 ? description.replace(/#/g, '＃') : description;
    if (isPlainYamlSafe(plainCandidate)) lines.push(`description: ${plainCandidate}`);
    else lines.push(`description: "${esc(description)}"`);
  }
  lines.push('model: inherit');
  if (tools) {
    lines.push('tools:');
    for (const t of tools) lines.push(`  - ${t}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n\n' + (body || '');
}

module.exports = { convertAgentMarkdownToDroid };
