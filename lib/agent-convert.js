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
  const parsed = matter(mdText || '', { language: 'yaml' });
  const src = parsed.data || {};

  const toolsList = toArray(src.tools);
  // Normalize description to single-line to avoid YAML folded block (>-)
  let description = src.description;
  if (typeof description === 'string') {
    description = description.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }

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
    if (/:\s/.test(s)) return false; // colon followed by space is ambiguous in plain scalars
    if (/#/.test(s)) return false; // could start a comment
    return true;
  }
  const lines = [];
  lines.push('---');
  lines.push(`name: ${name}`);
  if (typeof description === 'string' && description.length) {
    if (isPlainYamlSafe(description)) lines.push(`description: ${description}`);
    else lines.push(`description: "${esc(description)}"`);
  }
  lines.push('model: inherit');
  if (tools) {
    lines.push('tools:');
    for (const t of tools) lines.push(`  - ${t}`);
  }
  lines.push('---');
  const body = parsed.content || '';
  return lines.join('\n') + '\n\n' + body;
}

module.exports = { convertAgentMarkdownToDroid };
