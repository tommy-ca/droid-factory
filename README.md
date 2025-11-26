# Droid Factory install

Install custom Factory Droid subagents, slash commands, hooks, and skills with a single `npx droid-factory` (or `bunx droid-factory`) call. By default it launches a guided, step‑by‑step installer where you pick the install location (personal or project) and choose which resources to install; flags are available for non‑interactive "install everything" runs.

## Usage

```bash
npx droid-factory
```
```bash
bunx droid-factory
```

The guided flow highlights existing files, lets you decide on overwrites, and ends with a concise summary.

Ensure **Custom Droids** are enabled in Factory (`/settings` → Experimental → Custom Droids) or by adding `"enableCustomDroids": true` to `~/.factory/settings.json`; otherwise the installed commands cannot launch their helper agents.

### Guided flow

- Step 1/6 — Choose install location (Personal `~/.factory` or Project `./.factory`)
- Step 2/6 — Choose source (Templates or Marketplace)

Templates (bundled):
- Step 3/6 — Install all commands and droids?
- Step 4/6 — Select commands to install
- Step 5/6 — Select droids to install
- Step 6/6 — Overwrite existing files if found?
- Summary shows what was created/overwritten/skipped and next steps

Marketplace:
- Step 3/6 — Enter marketplace (path/url/owner/repo)
- Step 4/6 — Install all plugins?
- Step 5/6 — Select plugins to install
- Step 6/6 — Overwrite existing files if found?
- Summary shows what was created/overwritten/skipped and next steps

### Optional flags (non-interactive)

- `--yes` — run without interactive confirmations
- `--dry-run` — preview actions and summary without writing files
- `--scope personal|project` and `--path <repo-root>` — target install location
- `--commands all|name1,name2`, `--droids all|name1,name2`, `--hooks all|name1,name2`, `--skills all|name1,name2` — select what to install
- `--only-commands`, `--only-droids`, `--only-hooks`, `--only-skills` — limit to one type
- `--no-commands`, `--no-droids`, `--no-hooks`, `--no-skills` — exclude specific types
- `--force` — overwrite existing files
- `--list` — list available templates
- `--verbose` — print the detailed plan
- Marketplace: `--marketplace <path|url|owner/repo>`, `--plugins all|name1,name2`, `--import marketplace|templates`, `--ref <branch-or-tag>`, `--debug`

### Resource Types

**Commands** (`.factory/commands/`) — Custom slash commands for Factory
**Droids** (`.factory/droids/`) — Custom subagents (mapped from Claude Code agents)
**Hooks** (`.factory/hooks/`) — Lifecycle hooks
**Skills** (`.factory/skills/`) — Directory-based skills with SKILL.md

## Contributing commands or droids

1. Fork this repository.
2. Add or modify Markdown templates in `templates/commands/` or `templates/droids/`.
3. Run `npm test` or `npm run lint` if scripts are provided (future roadmap).
4. Verify your changes locally (see "Local development" below).
5. Commit with clear messages and open a pull request against the main branch.
6. Include before/after installer output as needed to demonstrate your change.

## Local development

```bash
git clone https://github.com/iannuttall/droid-factory.git
cd droid-factory
npm install

node bin/droid-factory.js --dry-run --yes
node bin/droid-factory.js --yes
```

Use `npm pack` to sanity-check the tarball before publishing, and remember to bump `package.json` versions per semantic versioning guidelines.

 
