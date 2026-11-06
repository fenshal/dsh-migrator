# DSH Migrator

A settings-page plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): see every plugin installed in your DSH profile, tick the ones you want, and take them to another machine — either as a paste-ready **migration note**, or as a **zip kit** that carries the local plugin sources and a restore script.

DSH 插件迁移工具：在「设置 → 插件迁移」里勾选已装插件，生成一段可粘贴的安装单，或直接下载带源码与恢复脚本的压缩包，换电脑时一把带走。

---

## What it solves

DSH installs plugins in two very different ways:

| kind | what it is | how it survives a move |
| --- | --- | --- |
| `official` | ships with DSH | nothing to do |
| `npm` | installed from the registry | only the version has to be remembered |
| `local` | a directory linked with `link:` (usually your own plugin) | the source has to travel with you |

Without this plugin you have to read `~/.dsh/profiles/desktop/package.json` by hand, work out which entries are local links, and copy those directories yourself. DSH Migrator does that inventory for you and produces something you can act on.

## Features

- **Full inventory** of the active profile: name, version, kind, GitHub repo (read from each package's `repository`/`homepage`), enabled state.
- **Selective export** — defaults to “every enabled non-official plugin”, with select-all / select-none helpers.
- **Migration note** — Markdown with a fenced `json dsh-plugin-migration` block plus seven execution instructions; paste it into a session on the new machine and the agent can follow it.
- **Zip kit** — self-contained package:

```
安装单.md              the same note, for humans
manifest.json          machine-readable inventory (name/version/kind/repo/leaf/order/enabled)
restore-plugins.ps1    restore script (supports -DryRun)
dsh-plugins/<leaf>/    sources of every selected local plugin
dsh-skills/            whatever lives in ~/.dsh/skills (imported skills and experts)
```

- **Restore script** — copies local plugin sources into the plugin root, merges `dependencies`, re-orders `dsh.profile.bundles`, backs up the original `package.json`, and copies skills without overwriting existing ones.
- **No network calls.** Everything is read from the local profile and written back into the response.

## Install

From a local checkout:

```powershell
# link the directory into the profile
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add "link:D:/path/to/dsh-migrator"
# then add "@local/dsh-migrator" to dsh.profile.bundles in package.json and restart DSH
```

Or simply run:

```
plugin_manager install_bundle D:\path\to\dsh-migrator
```

Once active, a new page appears in **Settings → 插件迁移**.

## Usage

1. Open **Settings → 插件迁移**.
2. Tick the plugins to take with you (official bundles are shown but cannot be selected).
3. Pick one:
   - **生成安装单** → copy / download `.md`, paste into a DSH session on the new machine.
   - **下载压缩包 (.zip)** → extract on the new machine and run the restore script.

### Restoring the zip on the new machine

```powershell
# see the plan first
pwsh -File .\restore-plugins.ps1 -DryRun

# apply
pwsh -File .\restore-plugins.ps1
```

Parameters:

| parameter | default | meaning |
| --- | --- | --- |
| `-Kit` | the script's own directory | where the kit was extracted |
| `-PluginRoot` | `manifest.json`'s `pluginRoot`, else `D:\DSH\...\dsh-plugins`, else `%USERPROFILE%\dsh-plugins` | where local plugin sources land |
| `-ProfileDir` | `~/.dsh/profiles/desktop` | the DSH profile to update |
| `-DryRun` | off | print the plan, change nothing |

Then restart DSH. If the plugin page reports pending installs, run `pnpm install` inside the profile directory.

## Routes

| method | path | purpose |
| --- | --- | --- |
| GET | `/migrator/list` | profile plugins with kind/version/repo/leaf |
| POST | `/migrator/build` | `{names}` → migration note text |
| POST | `/migrator/zip` | `{names}` → `application/zip` |

## Security and boundaries

- Reads only `~/.dsh/profiles/desktop/package.json`, the linked plugin directories and `~/.dsh/skills`.
- No network access, no credential access: `credentials`, sessions and settings secrets are **not** included.
- The zip is assembled in memory with a built-in ZIP writer (no third-party dependency).
- The restore script backs up the target `package.json` before writing and never removes existing bundle entries.

## Limits

- `npm` plugins are recorded by name and version only; the new machine still needs registry access to install them.
- Local plugins published on GitHub are listed with their repo, but the kit ships the local source as-is — it does not pull from the remote.
- Skills are copied verbatim; plugin-specific state files (for example a session-scoped selection) are intentionally left out, since they refer to sessions that do not exist on the new machine.

## Development

```
index.js          host side: inventory, note builder, zip writer, HTTP routes
client.js         web side: settings page (inline styles, no external CSS)
cordis.patch.yml  bundle patch that inserts the plugin
```

`node --check index.js && node --check client.js` before shipping; the client bundle only re-mounts after the plugin is toggled off and on again.

## License

MIT
