# Droid Factory install

Install custom Factory Droid subagents and delegate work using custom slash commands with a single `npx droid-factory` (or `bunx droid-factory`) call. By default it launches a guided, step‑by‑step installer where you pick the install location (personal or project) and choose which commands and droids to install; flags are available for non‑interactive “install everything” runs.

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

- Step 1: Choose install location — Personal (`~/.factory`) or Project (`./.factory`)
- Step 2: Install everything? — Yes installs all; No lets you pick
- Step 3: Select commands — existing items are labeled `(installed)` and preselected; Space toggles, Enter confirms
- Step 4: Select droids — same behavior as commands
- Overwrite: choose whether to overwrite existing files or skip them
- Summary: shows the target path, what was created/overwritten/skipped, and next steps to reload commands

### Optional flags (non-interactive)

- `--yes` — run without interactive confirmations
- `--dry-run` — preview actions and summary without writing files
- `--scope personal|project` and `--path <repo-root>` — target install location
- `--commands all|name1,name2` and `--droids all|name1,name2` — select what to install
- `--only-commands`, `--only-droids` — limit to one type
- `--force` — overwrite existing files
- `--list` — list available templates
- `--verbose` — print the detailed plan (even in guided mode)

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

 
