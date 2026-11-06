window.__ModuleLoader__.load({
  id: '@local/dsh-migrator',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const S = {
      wrap: { padding: '4px 2px 24px', maxWidth: 760, color: 'inherit' },
      h1: { fontSize: 16, fontWeight: 600, margin: '0 0 6px' },
      sub: { fontSize: 12.5, opacity: 0.6, margin: '0 0 16px', lineHeight: 1.6 },
      bar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 10px' },
      btn: {
        fontSize: 12.5,
        padding: '5px 11px',
        borderRadius: 7,
        border: '1px solid rgba(127,140,160,.30)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        lineHeight: 1.5,
      },
      btnOn: { borderColor: 'rgba(64,132,255,.75)', background: 'rgba(64,132,255,.14)' },
      primary: { borderColor: 'rgba(64,132,255,.85)', background: 'rgba(64,132,255,.22)', fontWeight: 600 },
      list: { border: '1px solid rgba(127,140,160,.22)', borderRadius: 10, overflow: 'hidden' },
      row: {
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '9px 12px',
        borderTop: '1px solid rgba(127,140,160,.13)',
        fontSize: 13,
      },
      chk: { marginTop: 3, accentColor: '#4b8bff' },
      name: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5, wordBreak: 'break-all' },
      meta: { fontSize: 11.5, opacity: 0.6, marginTop: 2, lineHeight: 1.5 },
      badge: {
        fontSize: 10.5,
        padding: '1px 6px',
        borderRadius: 999,
        border: '1px solid rgba(127,140,160,.35)',
        marginLeft: 6,
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
      },
      mono: {
        width: '100%',
        minHeight: 240,
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 11.5,
        lineHeight: 1.55,
        padding: 10,
        borderRadius: 10,
        border: '1px solid rgba(127,140,160,.28)',
        background: 'rgba(127,140,160,.06)',
        color: 'inherit',
        resize: 'vertical',
        boxSizing: 'border-box',
      },
      note: { fontSize: 12, opacity: 0.7, marginTop: 8 },
      err: { fontSize: 12.5, color: '#e0645a', marginTop: 8 },
      counts: { fontSize: 12, opacity: 0.62, marginLeft: 'auto' },
    };

    function badgeOf(p) {
      if (p.kind === 'official') return '自带';
      if (p.kind === 'local') return '本地';
      return 'npm';
    }

    function MigratorPage() {
      const [plugins, setPlugins] = React.useState(null);
      const [sel, setSel] = React.useState({});
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [zipBusy, setZipBusy] = React.useState(false);
      const [out, setOut] = React.useState('');
      const [note, setNote] = React.useState('');
      const areaRef = React.useRef(null);

      React.useEffect(function () {
        let alive = true;
        fetch('/migrator/list')
          .then(function (r) {
            return r.json();
          })
          .then(function (res) {
            if (!alive) return;
            if (!res || !res.ok) {
              setError((res && res.error) || '读取插件列表失败');
              setPlugins([]);
              return;
            }
            const list = res.plugins || [];
            setPlugins(list);
            const init = {};
            for (const p of list) if (p.enabled && p.kind !== 'official') init[p.name] = true;
            setSel(init);
          })
          .catch(function (err) {
            if (!alive) return;
            setError(String((err && err.message) || err));
            setPlugins([]);
          });
        return function () {
          alive = false;
        };
      }, []);

      function toggle(name) {
        setSel(function (prev) {
          const next = Object.assign({}, prev);
          if (next[name]) delete next[name];
          else next[name] = true;
          return next;
        });
      }

      function setAll(kind) {
        if (!plugins) return;
        const next = {};
        for (const p of plugins) {
          if (p.kind === 'official') continue;
          if (kind === 'none') continue;
          if (kind === 'third' && !p.enabled) continue;
          next[p.name] = true;
        }
        setSel(next);
      }

      function build() {
        const names = Object.keys(sel);
        if (!names.length) {
          setNote('至少选一个插件');
          return;
        }
        setBusy(true);
        setNote('');
        fetch('/migrator/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (res) {
            if (!res || !res.ok) throw new Error((res && res.error) || '生成失败');
            setOut(res.text || '');
            setNote('已生成 ' + res.count + ' 个插件、' + res.chars + ' 字符');
          })
          .catch(function (err) {
            setError(String((err && err.message) || err));
          })
          .finally(function () {
            setBusy(false);
          });
      }

      function copy() {
        if (!out) return;
        const done = function () {
          setNote('已复制到剪贴板，粘贴给新会话即可');
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(out).then(done).catch(function () {
            fallbackCopy();
          });
        } else {
          fallbackCopy();
        }
        function fallbackCopy() {
          const el = areaRef.current;
          if (!el) return;
          el.focus();
          el.select();
          try {
            document.execCommand('copy');
            done();
          } catch (err) {
            setNote('复制失败，请手动全选复制');
          }
        }
      }

      function download() {
        if (!out) return;
        const blob = new Blob([out], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'dsh-plugin-migration.md';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 0);
      }

      function downloadZip() {
        const names = Object.keys(sel);
        if (!names.length) {
          setNote('至少选一个插件');
          return;
        }
        setZipBusy(true);
        setNote('');
        setError('');
        fetch('/migrator/zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names }),
        })
          .then(function (r) {
            if (!r.ok) throw new Error('打包失败：HTTP ' + r.status);
            return r.blob();
          })
          .then(function (blob) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'dsh-plugins-' + new Date().toISOString().slice(0, 10) + '.zip';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
              URL.revokeObjectURL(a.href);
              a.remove();
            }, 0);
            setNote(
              '已打包 ' +
                names.length +
                ' 个插件（' +
                Math.round((blob.size / 1024 / 1024) * 10) / 10 +
                ' MB），解压后运行 restore-plugins.ps1',
            );
          })
          .catch(function (err) {
            setError(String((err && err.message) || err));
          })
          .finally(function () {
            setZipBusy(false);
          });
      }

      if (!plugins) {
        return h('div', { style: S.wrap }, h('div', { style: S.sub }, '读取中…'));
      }

      const counts = {};
      for (const p of plugins) counts[p.kind] = (counts[p.kind] || 0) + 1;
      const chosen = Object.keys(sel).length;

      const rows = plugins.map(function (p) {
        const isOfficial = p.kind === 'official';
        return h(
          'div',
          { key: p.name, style: S.row },
          h('input', {
            type: 'checkbox',
            style: S.chk,
            checked: isOfficial ? false : Boolean(sel[p.name]),
            disabled: isOfficial,
            onChange: function () {
              toggle(p.name);
            },
          }),
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h(
              'div',
              { style: S.name },
              p.name,
              h('span', { style: S.badge }, badgeOf(p)),
              p.version ? h('span', { style: S.badge }, p.version) : null,
              p.enabled ? null : h('span', { style: S.badge }, '停用'),
            ),
            h(
              'div',
              { style: S.meta },
              p.repo ? 'GitHub: ' + p.repo : p.kind === 'local' ? '本地源码，无公开仓库' : isOfficial ? 'DSH 自带，无需安装' : '',
            ),
          ),
        );
      });

      return h(
        'div',
        { style: S.wrap },
        h('div', { style: S.h1 }, '插件迁移'),
        h(
          'div',
          { style: S.sub },
          '勾选要带走的插件，然后二选一：① 生成「安装单」文本，粘贴到新电脑的 DSH 会话里让它照着装；② 下载压缩包，里面带上本地插件源码和恢复脚本，断网也能装。',
        ),
        h(
          'div',
          { style: S.bar },
          h(
            'button',
            { style: S.btn, onClick: function () { setAll('third'); } },
            '选启用项',
          ),
          h('button', { style: S.btn, onClick: function () { setAll('none'); } }, '全不选'),
          h('span', { style: S.counts }, '自带 ' + (counts.official || 0) + ' · 本地 ' + (counts.local || 0) + ' · npm ' + (counts.npm || 0) + ' · 已选 ' + chosen),
        ),
        h('div', { style: S.list }, rows.length ? rows : h('div', { style: Object.assign({}, S.row, { opacity: 0.6 }) }, '没有读到插件')),
        error ? h('div', { style: S.err }, error) : null,
        h(
          'div',
          { style: Object.assign({}, S.bar, { marginTop: 14 }) },
          h(
            'button',
            { style: Object.assign({}, S.btn, S.primary), onClick: build, disabled: busy },
            busy ? '生成中…' : '生成安装单',
          ),
          out ? h('button', { style: S.btn, onClick: copy }, '复制') : null,
          out ? h('button', { style: S.btn, onClick: download }, '下载 .md') : null,
          h(
            'button',
            { style: Object.assign({}, S.btn, S.primary), onClick: downloadZip, disabled: zipBusy },
            zipBusy ? '打包中…' : '下载压缩包 (.zip)',
          ),
        ),
        out
          ? h('textarea', {
              ref: areaRef,
              style: S.mono,
              readOnly: true,
              value: out,
              spellCheck: false,
              onFocus: function (e) { e.target.select(); },
            })
          : null,
        note ? h('div', { style: S.note }, note) : null,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            { name: 'settings.section', id: 'migrator', order: 60, label: '插件迁移' },
            MigratorPage,
          );
        });
      },
    };
  },
});
