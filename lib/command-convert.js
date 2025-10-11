"use strict";

const matter = require('gray-matter');

function normalizeSingleLine(s) {
  return String(s).replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function deriveDescriptionFromBody(content) {
  const lines = String(content || '').split(/\r?\n/);
  for (let line of lines) {
    line = (line || '').trim();
    if (!line) continue;
    line = line.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
    line = normalizeSingleLine(line);
    if (line) {
      if (line.length > 200) {
        const cut = line.slice(0, 200);
        return cut.replace(/\s+\S*$/, '').trim();
      }
      return line;
    }
  }
  return '';
}

function isPlainYamlSafe(s) {
  if (typeof s !== 'string') return false;
  if (!s.length) return true;
  if (/\r|\n/.test(s)) return false;
  if (/^\s/.test(s)) return false;
  if (/\s$/.test(s)) return false;
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s)) return false;
  if (/:\s/.test(s)) return false;
  if (/#/.test(s)) return false;
  return true;
}

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function emitYamlKV(key, value, { alwaysQuote = false } = {}) {
  if (value === undefined || value === null) return null;
  const v = String(value);
  if (!v.length) return `${key}:`;
  if (!alwaysQuote && isPlainYamlSafe(v)) return `${key}: ${v}`;
  return `${key}: "${esc(v)}"`;
}

function convertCommandMarkdownToFactory(mdText) {
  try {
    const parsed = matter(mdText || '', { language: 'yaml' });
    const src = parsed.data || {};
    const body = parsed.content || '';

    let description = src.description;
    if (typeof description === 'string' && description.trim().length) {
      description = normalizeSingleLine(description);
    } else {
      const derived = deriveDescriptionFromBody(body);
      description = derived || undefined;
    }

    let argHint = src['argument-hint'];
    if (Array.isArray(argHint)) {
      const items = argHint.map((x) => String(x).trim()).filter(Boolean);
      argHint = items.length ? items.map((x) => `[${x}]`).join(' ') : undefined;
    } else if (argHint !== undefined && argHint !== null) {
      argHint = normalizeSingleLine(String(argHint));
      if (argHint === '') argHint = undefined;
    }

    let allowedTools = src['allowed-tools'];
    if (Array.isArray(allowedTools)) {
      allowedTools = allowedTools.map((x) => String(x).trim()).filter(Boolean).join(', ');
    } else if (allowedTools !== undefined && allowedTools !== null) {
      allowedTools = String(allowedTools).trim();
      if (allowedTools === '') allowedTools = undefined;
    }

    const lines = ['---'];
    const addLine = (str) => { if (str) lines.push(str); };

    if (description !== undefined) addLine(emitYamlKV('description', description, { alwaysQuote: false }));
    if (argHint !== undefined) addLine(emitYamlKV('argument-hint', argHint, { alwaysQuote: true }));
    if (allowedTools !== undefined) addLine(emitYamlKV('allowed-tools', allowedTools, { alwaysQuote: true }));

    lines.push('---');

    return lines.join('\n') + '\n\n' + body;
  } catch (e) {
    return mdText || '';
  }
}

module.exports = { convertCommandMarkdownToFactory };
