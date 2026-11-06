// @local/dsh-migrator — 导出已装插件为「安装单文本」或「迁移压缩包」
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { homedir, hostname } from 'node:os';
import { deflateRawSync } from 'node:zlib';

export const name = '@local/dsh-migrator';
export const inject = ['webServer'];

const HOME = homedir();
const PROFILE = join(HOME, '.dsh', 'profiles', 'desktop');
const PROFILE_PKG = join(PROFILE, 'package.json');
const FALLBACK_ROOT = join('D:', 'DSH', 'workspaces', 'default-workspace', 'dsh-plugins');

// 本机插件源码目录：优先环境变量，其次从 `link:` 依赖反推，最后回落到约定路径。
function pluginRootOf(plugins) {
  const fromEnv = process.env.DSH_PLUGIN_ROOT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const p of plugins || []) {
    if (p.kind === 'local' && p.dir) {
      const parent = dirname(p.dir);
      if (existsSync(parent)) return parent;
    }
  }
  return FALLBACK_ROOT;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '.turbo']);
const MAX_FILES = 600;
const MAX_BYTES = 60 * 1024 * 1024;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function metaOf(pkgName) {
  const pkg = join(PROFILE, 'node_modules', pkgName, 'package.json');
  if (!existsSync(pkg)) return {};
  return readJson(pkg) || {};
}

function repoOf(meta) {
  const raw =
    (meta.repository && (typeof meta.repository === 'string' ? meta.repository : meta.repository.url)) ||
    meta.homepage ||
    '';
  const m = /github\.com[/:]([^/]+)\/([^/#?]+)/i.exec(String(raw));
  if (!m) return null;
  return m[1] + '/' + m[2].replace(/\.git$/i, '');
}

function leafOf(spec) {
  const dir = String(spec || '').replace(/^link:/, '');
  if (!dir) return null;
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function localDirOf(spec) {
  const dir = String(spec || '').replace(/^link:/, '');
  return dir || null;
}

function collect() {
  const pkg = readJson(PROFILE_PKG) || {};
  const deps = pkg.dependencies || {};
  const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [];
  const out = [];
  for (let i = 0; i < bundles.length; i += 1) {
    const entry = bundles[i];
    const depSpec = deps[entry];
    const meta = depSpec ? metaOf(entry) : {};
    const kind = !depSpec ? 'official' : String(depSpec).startsWith('link:') ? 'local' : 'npm';
    out.push({
      name: entry,
      version: kind === 'official' ? String(meta.version || '') : String(meta.version || depSpec || ''),
      kind,
      enabled: true,
      order: i,
      spec: depSpec || null,
      leaf: kind === 'local' ? leafOf(depSpec) : null,
      dir: kind === 'local' ? localDirOf(depSpec) : null,
      repo: kind === 'official' ? null : repoOf(meta),
      description: String(meta.description || '').slice(0, 160),
    });
  }
  for (const depName of Object.keys(deps)) {
    if (bundles.includes(depName)) continue;
    const spec = deps[depName];
    const meta = metaOf(depName);
    out.push({
      name: depName,
      version: String(meta.version || spec || ''),
      kind: String(spec).startsWith('link:') ? 'local' : 'npm',
      enabled: false,
      order: 900 + out.length,
      spec,
      leaf: String(spec).startsWith('link:') ? leafOf(spec) : null,
      dir: String(spec).startsWith('link:') ? localDirOf(spec) : null,
      repo: repoOf(meta),
      description: String(meta.description || '').slice(0, 160),
    });
  }
  return { pkg, plugins: out };
}

function pick(names) {
  const { plugins } = collect();
  const wanted = new Set(
    Array.isArray(names) && names.length ? names : plugins.filter((p) => p.enabled).map((p) => p.name),
  );
  return plugins.filter((p) => wanted.has(p.name));
}

function payloadOf(picked) {
  return {
    type: 'dsh-plugin-migration',
    version: 1,
    exportedAt: new Date().toISOString(),
    machine: hostname(),
    profileDir: '~/.dsh/profiles/desktop',
    pluginRoot: pluginRootOf(picked).replace(/\\/g, '/'),
    plugins: picked.map((p) => ({
      name: p.name,
      version: p.version,
      kind: p.kind,
      repo: p.repo,
      leaf: p.leaf,
      enabled: p.enabled,
      order: p.order,
    })),
  };
}

function buildText(picked, payload) {
  const enabled = picked.filter((p) => p.enabled);
  const disabled = picked.filter((p) => !p.enabled);
  const npmOnes = enabled.filter((p) => p.kind === 'npm');
  const localWithRepo = enabled.filter((p) => p.kind === 'local' && p.repo);
  const localNoRepo = enabled.filter((p) => p.kind === 'local' && !p.repo);

  const lines = [];
  lines.push('# DSH 插件迁移单');
  lines.push('');
  lines.push(
    '导出时间 ' +
      payload.exportedAt +
      '｜来自 ' +
      payload.machine +
      '｜共 ' +
      picked.length +
      ' 个（启用 ' +
      enabled.length +
      '，停用 ' +
      disabled.length +
      '）',
  );
  lines.push('');
  lines.push('把下面整段内容粘贴到新电脑上的 DSH 会话里，它会按指令装好。');
  lines.push('');
  lines.push('> 如果拿到的是压缩包：解压后先跑 `restore-plugins.ps1 -DryRun` 看计划，确认后去掉 `-DryRun` 执行。压缩包里已含本地插件源码与 skills，不需要再粘贴本文件。');
  lines.push('');
  lines.push('```json dsh-plugin-migration');
  lines.push(JSON.stringify(payload, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## 给新电脑会话的执行指令');
  lines.push('');
  lines.push('1. 上面的 JSON 是待恢复的插件清单，`kind` 有三种：`official`（DSH 自带，跳过）、`npm`（从 npm 装）、`local`（本地源码，用 `link:` 接进来）。');
  lines.push('2. 先确认 `~/.dsh/profiles/desktop/package.json` 存在；不存在说明新电脑还没初始化过 DSH，先启动一次 DSH。');
  lines.push('3. `npm` 项：在 `~/.dsh/profiles/desktop` 里执行 `pnpm add <name>@<version>`；没有 pnpm 就用 `npm i --save-exact <name>@<version>`。');
  lines.push('4. `local` 且 `repo` 非空：把仓库克隆到 `<pluginRoot>/<leaf>`（pluginRoot 见 JSON），例如 `gh repo clone <repo> "<pluginRoot>/<leaf>"`；然后写 `"<name>": "link:<pluginRoot>/<leaf>"`。');
  lines.push('5. `local` 且 `repo` 为空：源码不在公开仓库，**不要瞎猜**，把这几项列给用户，让他把源码目录拷贝到 `<pluginRoot>` 下再继续。');
  lines.push('6. 依赖写完后，把启用项按 JSON 里 `order` 升序合并进 `package.json` 的 `dsh.profile.bundles`（保留新电脑原有的官方项），备份原文件，然后重启 DSH。');
  lines.push('7. 重启后打开「设置 → 插件」核对：数量和版本应与清单一致；缺的按第 5 步处理。');
  lines.push('');
  lines.push('## 摘要');
  lines.push('');
  lines.push('- npm 插件：' + (npmOnes.length ? npmOnes.map((p) => p.name + '@' + p.version).join('、') : '无'));
  lines.push(
    '- 本地插件（有公开仓库）：' +
      (localWithRepo.length ? localWithRepo.map((p) => p.name + ' (' + p.repo + ')').join('、') : '无'),
  );
  lines.push('- 本地插件（需人工提供源码）：' + (localNoRepo.length ? localNoRepo.map((p) => p.name).join('、') : '无'));
  if (disabled.length) lines.push('- 本次不启用：' + disabled.map((p) => p.name).join('、'));
  return lines.join('\n');
}

// ---------- 最小 ZIP 写入器（无第三方依赖） ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i += 1) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function zipBuffer(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 6 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDir, eocd]);
}

function walkDir(root, base, prefix, out, state) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (state.count >= MAX_FILES || state.bytes >= MAX_BYTES) return;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkDir(full, base, prefix, out, state);
      continue;
    }
    if (!entry.isFile()) continue;
    let size = 0;
    try {
      size = statSync(full).size;
    } catch {
      continue;
    }
    if (size > 40 * 1024 * 1024) continue;
    let data;
    try {
      data = readFileSync(full);
    } catch {
      continue;
    }
    const rel = relative(base, full).replace(/\\/g, '/');
    out.push({ name: prefix + rel, data });
    state.count += 1;
    state.bytes += size;
  }
}

const RESTORE_PS1 = [
  '# 恢复 DSH 插件（由 dsh-migrator 生成）',
  '# 用法：pwsh -File .\\restore-plugins.ps1 -DryRun     先看要做什么',
  '#       pwsh -File .\\restore-plugins.ps1             真的写入',
  'param(',
  '  [string]$Kit = "",',
  '  [string]$PluginRoot = "",',
  '  [string]$ProfileDir = "$env:USERPROFILE\\.dsh\\profiles\\desktop",',
  '  [switch]$DryRun',
  ')',
  "$ErrorActionPreference = 'Stop'",
  'if (-not $Kit) { $Kit = Split-Path -Parent $MyInvocation.MyCommand.Path }',
  '$manifestPath = Join-Path $Kit "manifest.json"',
  'if (-not (Test-Path $manifestPath)) { throw "找不到 manifest.json：$manifestPath" }',
  '$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json',
  'if (-not $PluginRoot) {',
  '  if ($manifest.pluginRoot) { $PluginRoot = $manifest.pluginRoot }',
  "  elseif (Test-Path 'D:\\') { $PluginRoot = 'D:\\DSH\\workspaces\\default-workspace\\dsh-plugins' }",
  "  else { $PluginRoot = Join-Path $env:USERPROFILE 'dsh-plugins' }",
  '}',
  'Write-Host "迁移包：$Kit"',
  'Write-Host "插件目录：$PluginRoot"',
  'Write-Host "profile：$ProfileDir"',
  '',
  '$localRoot = Join-Path $Kit "dsh-plugins"',
  'foreach ($b in $manifest.plugins) {',
  "  if ($b.kind -ne 'local' -or -not $b.leaf) { continue }",
  '  $src = Join-Path $localRoot $b.leaf',
  '  $dst = Join-Path $PluginRoot $b.leaf',
  '  if (-not (Test-Path $src)) { Write-Warning "包里没有 $($b.leaf)，跳过"; continue }',
  '  if ($DryRun) { Write-Host "[dry] 复制 $($b.leaf) -> $dst" }',
  '  else {',
  '    New-Item -ItemType Directory -Force -Path $dst | Out-Null',
  '    robocopy $src $dst /E /XD node_modules .git dist /NFL /NDL /NJH /NJS /NP | Out-Null',
  '    Write-Host "复制 $($b.leaf) -> $dst"',
  '  }',
  '}',
  '',
  '$skillsSrc = Join-Path $Kit "dsh-skills"',
  '$skillsDst = Join-Path $env:USERPROFILE ".dsh\\skills"',
  'if (Test-Path $skillsSrc) {',
  '  if ($DryRun) { Write-Host "[dry] 复制 skills -> $skillsDst" }',
  '  else {',
  '    New-Item -ItemType Directory -Force -Path $skillsDst | Out-Null',
  '    robocopy $skillsSrc $skillsDst /E /XC /XN /XO /NFL /NDL /NJH /NJS /NP | Out-Null',
  '    Write-Host "复制 skills -> $skillsDst（已存在的不覆盖）"',
  '  }',
  '}',
  '',
  '$pkgPath = Join-Path $ProfileDir "package.json"',
  'if (Test-Path $pkgPath) { $pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $pkg = [pscustomobject]@{ name = "dsh-profile-desktop"; private = $true } }',
  '$deps = [ordered]@{}',
  'if ($pkg.dependencies) { $pkg.dependencies.PSObject.Properties | ForEach-Object { $deps[$_.Name] = [string]$_.Value } }',
  'foreach ($b in $manifest.plugins) {',
  "  if ($b.kind -eq 'official') { continue }",
  "  if ($b.kind -eq 'local') {",
  "    $target = Join-Path $PluginRoot $b.leaf",
  "    $spec = 'link:' + ($target -replace '\\\\', '/')",
  '    $deps[$b.name] = $spec',
  '  } elseif (-not $deps.Contains($b.name)) {',
  '    $deps[$b.name] = $b.version',
  '  }',
  '}',
  '',
  '$existing = @()',
  'if ($pkg.dsh -and $pkg.dsh.profile -and $pkg.dsh.profile.bundles) { $existing = @($pkg.dsh.profile.bundles) }',
  '$wanted = @($manifest.plugins | Where-Object { $_.enabled -and $_.kind -ne "official" } | Sort-Object order | ForEach-Object { $_.name })',
  '$newBundles = @($existing | Where-Object { $wanted -notcontains $_ })',
  'foreach ($n in $wanted) { if ($newBundles -notcontains $n) { $newBundles += $n } }',
  '',
  '$out = [ordered]@{}',
  'if ($pkg) { $pkg.PSObject.Properties | ForEach-Object { $out[$_.Name] = $_.Value } }',
  '$out["dependencies"] = $deps',
  '$dsh = [ordered]@{}',
  'if ($pkg.dsh) { $pkg.dsh.PSObject.Properties | ForEach-Object { $dsh[$_.Name] = $_.Value } }',
  '$prof = [ordered]@{}',
  'if ($pkg.dsh -and $pkg.dsh.profile) { $pkg.dsh.profile.PSObject.Properties | ForEach-Object { $prof[$_.Name] = $_.Value } }',
  '$prof["bundles"] = $newBundles',
  '$dsh["profile"] = $prof',
  '$out["dsh"] = $dsh',
  '',
  'Write-Host ""',
  'Write-Host "将写入 bundles："',
  '$newBundles | ForEach-Object { Write-Host "  - $_" }',
  'if ($DryRun) { Write-Host ""; Write-Host "试运行结束，未改文件。"; return }',
  '$bak = Join-Path $ProfileDir ("package.json.bak-" + (Get-Date -Format "yyyyMMdd-HHmmss"))',
  'if (Test-Path $pkgPath) { Copy-Item $pkgPath $bak -Force; Write-Host "已备份 $bak" }',
  '$json = $out | ConvertTo-Json -Depth 8',
  '[IO.File]::WriteAllText($pkgPath, $json, (New-Object System.Text.UTF8Encoding($false)))',
  'Write-Host "已写入 $pkgPath"',
  'Write-Host "下一步：重启 DeepSeek Harness；若插件页提示待安装，在 profile 目录执行 pnpm install。"',
].join('\r\n');

function buildZip(picked) {
  const payload = payloadOf(picked);
  const text = buildText(picked, payload);
  const entries = [];

  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  entries.push({ name: '安装单.md', data: Buffer.concat([bom, Buffer.from(text, 'utf8')]) });
  entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(payload, null, 2), 'utf8') });
  entries.push({ name: 'restore-plugins.ps1', data: Buffer.concat([bom, Buffer.from(RESTORE_PS1, 'utf8')]) });

  const state = { count: 0, bytes: 0 };
  const copied = [];
  for (const p of picked) {
    if (p.kind !== 'local' || !p.dir || !p.leaf) continue;
    if (!existsSync(p.dir)) continue;
    const before = state.count;
    walkDir(p.dir, p.dir, 'dsh-plugins/' + p.leaf + '/', entries, state);
    if (state.count > before) copied.push(p.leaf);
  }

  const skillsDir = join(HOME, '.dsh', 'skills');
  let skillCount = 0;
  if (existsSync(skillsDir)) {
    const before = state.count;
    walkDir(skillsDir, skillsDir, 'dsh-skills/', entries, state);
    skillCount = state.count - before;
  }

  return { buffer: zipBuffer(entries), payload, text, entries: entries.length, copied };
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readBody(req) {
  return new Promise((resolvePromise) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolvePromise(JSON.parse(data || '{}'));
      } catch {
        resolvePromise({});
      }
    });
    req.on('error', () => resolvePromise({}));
  });
}

async function handle(req, res) {
  const url = String(req.url || '').split('?')[0];

  if (url === '/migrator/list' && req.method === 'GET') {
    if (!existsSync(PROFILE_PKG)) {
      return sendJson(res, 200, { ok: false, error: 'profile package.json not found', profileDir: PROFILE });
    }
    const { plugins } = collect();
    return sendJson(res, 200, { ok: true, profileDir: PROFILE, pluginRoot: pluginRootOf(plugins), plugins });
  }

  if (url === '/migrator/build' && req.method === 'POST') {
    const body = await readBody(req);
    const picked = pick(body.names);
    const payload = payloadOf(picked);
    const text = buildText(picked, payload);
    return sendJson(res, 200, { ok: true, count: picked.length, chars: text.length, text });
  }

  if (url === '/migrator/zip' && req.method === 'POST') {
    const body = await readBody(req);
    const built = buildZip(pick(body.names));
    const stamp = new Date().toISOString().slice(0, 10);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="dsh-plugins-' + stamp + '.zip"; filename*=UTF-8\'\'dsh-plugins-' + stamp + '.zip',
    );
    res.setHeader('Content-Length', built.buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.end(built.buffer);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
}

export function apply(ctx) {
  ctx.effect(() => {
    const disposers = ['/migrator/list', '/migrator/build', '/migrator/zip'].map((path) =>
      ctx.webServer.register({
        kind: 'exact',
        path,
        handler(req, res) {
          handle(req, res).catch((err) => {
            try {
              sendJson(res, 500, { ok: false, error: String((err && err.message) || err) });
            } catch {}
          });
        },
      }),
    );
    return () => {
      for (const off of disposers) {
        try {
          if (typeof off === 'function') off();
        } catch {}
      }
    };
  });
}
