/* AgentLoop Harness 控制台 */
const API = '/api/v1';
let TOKEN = localStorage.getItem('harness_token') || '';
let ME = null;
let TAXONOMY = null;
const CHARTS = {};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%');
const num = (v) => (v || 0).toLocaleString('zh-CN');
const money = (v) => '$' + (v || 0).toFixed(3);
const dt = (s) => (s ? String(s).replace('T', ' ').slice(0, 19) : '—');
const dayOf = (s) => (s ? String(s).slice(0, 10) : '—');
const dur = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : (ms || 0) + 'ms');

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const resp = await fetch(API + path, {
    method: opts.method || 'GET', headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { detail: text }; }
  if (!resp.ok) {
    if (resp.status === 401) { logout(); }
    throw new Error((data && (data.detail || data.message)) || ('HTTP ' + resp.status));
  }
  return data;
}

function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function modal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function chart(id, option) {
  const el = document.getElementById(id);
  if (!el) return;
  if (CHARTS[id]) { CHARTS[id].dispose(); }
  const c = echarts.init(el, null, { renderer: 'canvas' });
  c.setOption(Object.assign({
    textStyle: { color: '#1f2328', fontSize: 11.5 },
    grid: { left: 44, right: 18, top: 30, bottom: 26 },
    tooltip: { trigger: 'axis' },
    legend: { textStyle: { color: '#6b7280', fontSize: 11 }, top: 0 },
  }, option));
  CHARTS[id] = c;
  window.addEventListener('resize', () => c.resize(), { once: true });
  return c;
}

/* ------------------------------------------------------------------ 登录 */

let loginMode = 'login';
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  loginMode = t.dataset.mode;
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $('#login-submit').textContent = loginMode === 'login' ? '进入控制台' : '注册并进入';
}));

$('#login-submit').addEventListener('click', async () => {
  const username = $('#login-user').value.trim();
  const password = $('#login-pass').value;
  $('#login-hint').textContent = '处理中…';
  try {
    const res = await api('/auth/' + loginMode, { method: 'POST', body: { username, password } });
    TOKEN = res.token;
    localStorage.setItem('harness_token', TOKEN);
    ME = res.user;
    await boot();
  } catch (e) {
    $('#login-hint').textContent = '失败：' + e.message;
  }
});

$('#logout').addEventListener('click', () => logout());
function logout() {
  TOKEN = '';
  localStorage.removeItem('harness_token');
  $('#shell').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
}

/* ------------------------------------------------------------------ 路由 */

const PAGES = {
  dashboard: { title: '总览大盘', render: pageDashboard },
  runs: { title: '运行记录', render: pageRuns },
  run: { title: '运行详情', render: pageRunDetail },
  cases: { title: '案例库', render: pageCases },
  case: { title: '案例详情', render: pageCaseDetail },
  replay: { title: '回放评测', render: pageReplay },
  alerts: { title: '监控告警', render: pageAlerts },
  optimize: { title: '优化建议', render: pageOptimize },
  entities: { title: '实体语义', render: pageEntities },
  settings: { title: '接入与设置', render: pageSettings },
  docs: { title: '使用说明', render: pageDocs },
};

async function router() {
  const hash = location.hash || '#/dashboard';
  const parts = hash.replace('#/', '').split('/');
  const key = PAGES[parts[0]] ? parts[0] : 'dashboard';
  const page = PAGES[key];
  $('#page-title').textContent = page.title;
  $('#page-actions').innerHTML = '';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#/' + key));
  $('#page').innerHTML = '<div class="card"><div class="empty">加载中…</div></div>';
  try {
    await page.render(parts[1] ? decodeURIComponent(parts[1]) : null);
  } catch (e) {
    $('#page').innerHTML = '<div class="card"><div class="empty">加载失败：' + esc(e.message) + '</div></div>';
  }
}
window.addEventListener('hashchange', router);

/* ------------------------------------------------------------------ 总览 */

async function pageDashboard() {
  const [ov, trend, faults, dims, cases, opts] = await Promise.all([
    api('/stats/overview'), api('/stats/trend?days=14'), api('/stats/faults'),
    api('/stats/dimensions'), api('/cases?status=badcase&limit=8'), api('/optimizations?status=draft'),
  ]);
  const kpi = (k, v, s, cls = '') => `<div class="kpi"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s || ''}</div></div>`;
  $('#page').innerHTML = `
  <div class="grid g4">
    ${kpi('上报运行数', num(ov.runs), `成功率 ${pct(ov.success_rate)} · 失败 ${ov.failed}`)}
    ${kpi('沉淀案例', num(ov.cases), `黄金 ${ov.golden} · BadCase ${ov.badcase} · 草稿 ${ov.draft}`)}
    ${kpi('回放平均分', ov.avg_score.toFixed(3), `回放 ${ov.replays} 次 · 通过率 ${pct(ov.replay_pass_rate)}`)}
    ${kpi('待确认优化', num(ov.optimizations_pending), `已提交 PR ${ov.optimizations_submitted} / 共 ${ov.optimizations}`)}
  </div>
  <div class="grid g4" style="margin-top:12px">
    ${kpi('Token 消耗', num(ov.tokens), `成本 ${money(ov.cost_usd)}`)}
    ${kpi('平均耗时', dur(ov.avg_duration_ms), `平均工具调用 ${ov.avg_tool_calls} 次`)}
    ${kpi('异常运行', num(ov.with_error), '带 error_type 的运行数')}
    ${kpi('四层真值门禁', ov.golden + '/' + (ov.cases || 1), '通过 GSTO 的黄金案例占比')}
  </div>

  <div class="grid g-2-1" style="margin-top:14px">
    <div class="card"><h2>运行量与评测分趋势（近 14 天）</h2><div id="c-trend" style="height:260px"></div></div>
    <div class="card"><h2>故障组分布</h2><div id="c-fault" style="height:260px"></div></div>
  </div>

  <div class="grid g2">
    <div class="card"><h2>各维度平均分（定因 40% / 定界 30% / 过程 30%）</h2><div id="c-dim" style="height:250px"></div></div>
    <div class="card">
      <div class="section-title"><h2>最近 BadCase</h2><a class="btn sm" href="#/cases">查看全部</a></div>
      ${(cases.items || []).length ? `<div class="table-wrap"><table><thead><tr><th>案例</th><th>故障类型</th><th>分数</th><th>状态</th></tr></thead><tbody>
        ${cases.items.map((c) => `<tr class="clickable" onclick="location.hash='#/case/${c.id}'">
          <td><b>${esc(c.case_key)}</b><div class="hint">${esc((c.title || '').slice(0, 30))}</div></td>
          <td>${esc(c.fault_type || '—')}</td>
          <td><span class="score-pill s-${c.last_verdict || 'error'}">${(c.last_score || 0).toFixed(2)}</span></td>
          <td><span class="badge">badcase</span></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">暂无 BadCase，去运行记录里沉淀案例</div>'}
    </div>
  </div>

  <div class="card">
    <div class="section-title"><h2>待确认的优化建议</h2><a class="btn sm" href="#/optimize">进入优化台</a></div>
    ${(opts || []).length ? (opts.slice(0, 4).map((o) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
        <span class="chip info">${esc(o.category)}</span> <b>${esc(o.title)}</b>
        <div class="hint mono">${esc(o.target_path)} · 关联 ${(o.case_ids || []).length} 个 BadCase</div></div>`).join(''))
      : '<div class="empty">暂无待确认建议，去「优化建议」页点一次分析</div>'}
  </div>`;

  const days = (trend.items || []).map((i) => i.day.slice(5));
  chart('c-trend', {
    legend: { data: ['运行数', '回放均分', 'Token(k)'] },
    xAxis: { type: 'category', data: days, axisLine: { lineStyle: { color: '#e3e7ec' } }, axisLabel: { color: '#6b7280' } },
    yAxis: [
      { type: 'value', name: '运行数', splitLine: { lineStyle: { color: '#eef1f4' } }, axisLabel: { color: '#6b7280' } },
      { type: 'value', name: '分数', max: 1, min: 0, splitLine: { show: false }, axisLabel: { color: '#6b7280' } },
    ],
    series: [
      { name: '运行数', type: 'bar', data: (trend.items || []).map((i) => i.runs), itemStyle: { color: '#85b7eb' }, barMaxWidth: 18 },
      { name: '回放均分', type: 'line', yAxisIndex: 1, smooth: true, data: (trend.items || []).map((i) => i.avg_score), itemStyle: { color: '#0f6e56' } },
      { name: 'Token(k)', type: 'line', smooth: true, data: (trend.items || []).map((i) => Math.round(i.tokens / 1000)), itemStyle: { color: '#ef9f27' } },
    ],
  });
  const fg = faults.by_group || [];
  chart('c-fault', {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: ['45%', '70%'], center: ['50%', '45%'],
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { fontSize: 11 },
      data: fg.map((g) => ({ name: g.group, value: g.total })),
      color: ['#85b7eb', '#5dcaa5', '#ef9f27', '#afa9ec', '#f0997b', '#b4b2a9'],
    }],
  });
  const dm = dims.items || [];
  chart('c-dim', {
    radar: {
      indicator: [{ name: '定因 (40%)', max: 1 }, { name: '定界 (30%)', max: 1 }, { name: '过程 (30%)', max: 1 }, { name: '综合', max: 1 }],
      radius: '62%', axisName: { color: '#6b7280', fontSize: 11 },
      splitLine: { lineStyle: { color: '#eef1f4' } }, splitArea: { areaStyle: { color: ['#fff', '#f8fafc'] } },
    },
    legend: { bottom: 0 },
    series: [{
      type: 'radar',
      data: dm.map((d, i) => ({
        name: d.mode + ' (' + d.n + '次)',
        value: [d.fault, d.entity, d.process, d.score],
        lineStyle: { color: ['#185fa5', '#0f6e56', '#854f0b'][i % 3] },
        areaStyle: { opacity: 0.12 },
      })),
    }],
  });

  const drafts = (opts || []).length;
  const badge = $('#nav-opt-badge');
  badge.textContent = drafts;
  badge.classList.toggle('hidden', !drafts);
}

/* ------------------------------------------------------------------ 运行记录 */

let runFilter = { status: '', q: '', agent: '', offset: 0 };

async function pageRuns() {
  const agents = await api('/agents');
  const data = await api(`/runs?status=${encodeURIComponent(runFilter.status)}&q=${encodeURIComponent(runFilter.q)}&agent=${encodeURIComponent(runFilter.agent)}&limit=25&offset=${runFilter.offset}`);
  $('#page-actions').innerHTML = `<button class="btn" id="seed-demo">生成演示数据</button>`;
  $('#page').innerHTML = `
  <div class="card">
    <div class="filters">
      <div><label>状态</label><select id="f-status">
        <option value="">全部</option><option value="success">success</option>
        <option value="partial">partial</option><option value="failed">failed</option></select></div>
      <div><label>Agent</label><select id="f-agent"><option value="">全部</option>
        ${agents.map((a) => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('')}</select></div>
      <div style="min-width:220px"><label>关键词（任务 / 错误类型 / run id）</label><input id="f-q" value="${esc(runFilter.q)}" /></div>
      <button class="btn primary" id="f-go">筛选</button>
      <button class="btn" id="f-reset">重置</button>
      <span class="hint">共 ${num(data.total)} 条</span>
    </div>
    <div class="table-wrap"><table><thead><tr>
      <th>Run</th><th>Agent</th><th>任务</th><th>状态</th><th>错误类型</th>
      <th>耗时</th><th>Token</th><th>工具调用</th><th>信号</th><th>案例</th><th>时间</th>
    </tr></thead><tbody>
    ${(data.items || []).length ? data.items.map((r) => `<tr class="clickable" onclick="location.hash='#/run/${r.id}'">
      <td class="mono">${esc(r.external_run_id)}</td>
      <td>${esc(r.agent_name || '—')}<div class="hint">${esc(r.agent_version || '')}</div></td>
      <td>${esc((r.task || '').slice(0, 34))}</td>
      <td><span class="chip ${r.status === 'success' ? 'ok' : r.status === 'failed' ? 'err' : 'warn'}">${esc(r.status)}</span></td>
      <td>${r.error_type ? `<span class="badge a">${esc(r.error_type)}</span>` : '<span class="hint">—</span>'}</td>
      <td>${dur(r.duration_ms)}</td>
      <td>${num(r.tokens_in + r.tokens_out)}</td>
      <td>${r.tool_calls}${r.tool_calls >= 15 ? ' <span class="badge">黑洞</span>' : ''}</td>
      <td>${r.signal_count}</td>
      <td>${r.case_count ? `<span class="badge b">${r.case_count}</span>` : '—'}</td>
      <td class="hint">${dt(r.started_at || r.created_at)}</td></tr>`).join('')
      : '<tr><td colspan="11"><div class="empty">暂无运行记录，用 SDK 上报或点右上角生成演示数据</div></td></tr>'}
    </tbody></table></div>
    <div class="pager">
      <button class="btn sm" id="prev" ${runFilter.offset <= 0 ? 'disabled' : ''}>上一页</button>
      <span>${runFilter.offset + 1} - ${Math.min(runFilter.offset + 25, data.total)}</span>
      <button class="btn sm" id="next" ${runFilter.offset + 25 >= data.total ? 'disabled' : ''}>下一页</button>
    </div>
  </div>`;
  $('#f-status').value = runFilter.status;
  $('#f-agent').value = runFilter.agent;
  $('#f-go').onclick = () => { runFilter = { status: $('#f-status').value, agent: $('#f-agent').value, q: $('#f-q').value.trim(), offset: 0 }; router(); };
  $('#f-reset').onclick = () => { runFilter = { status: '', q: '', agent: '', offset: 0 }; router(); };
  $('#prev').onclick = () => { runFilter.offset = Math.max(0, runFilter.offset - 25); router(); };
  $('#next').onclick = () => { runFilter.offset += 25; router(); };
  $('#seed-demo').onclick = seedDemo;
}

async function seedDemo() {
  toast('正在生成演示数据…');
  try {
    const r = await api('/demo/seed', { method: 'POST', body: {} });
    toast(`已生成：运行 +${r.runs_created}，案例 ${r.cases_total}，优化建议 ${r.optimizations}`);
    router();
  } catch (e) { toast('生成失败：' + e.message); }
}

async function pageRunDetail(id) {
  const r = await api('/runs/' + id);
  const spans = r.spans || [];
  const t0 = spans.length ? Math.min(...spans.map((s) => s.start_ms)) : 0;
  const t1 = spans.length ? Math.max(...spans.map((s) => s.end_ms || s.start_ms)) : 1;
  const span = Math.max(1, t1 - t0);
  const byMod = {};
  (r.signals || []).forEach((s) => { byMod[s.modality] = (byMod[s.modality] || 0) + 1; });

  $('#page-actions').innerHTML = `<button class="btn primary" id="to-case">沉淀为案例</button>`;
  $('#page').innerHTML = `
  <div class="grid g-2-1">
    <div class="card">
      <div class="section-title"><h2>${esc(r.task || r.external_run_id)}</h2>
        <span class="chip ${r.status === 'success' ? 'ok' : r.status === 'failed' ? 'err' : 'warn'}">${esc(r.status)}</span></div>
      <dl class="kv">
        <dt>Run ID</dt><dd class="mono">${esc(r.external_run_id)}</dd>
        <dt>Agent</dt><dd>${esc(r.agent_name || '—')} · ${esc(r.agent_type || '')} · ${esc(r.agent_version || '')}</dd>
        <dt>模型 / 环境</dt><dd>${esc(r.model || '—')} · ${esc(r.env || '')} · ${esc((r.meta && r.meta.namespace) || '')}</dd>
        <dt>错误</dt><dd>${r.error_type ? `<span class="badge a">${esc(r.error_type)}</span> ${esc(r.error_message || '')}` : '—'}</dd>
        <dt>耗时 / 步数</dt><dd>${dur(r.duration_ms)} · ${r.steps} 步 · 工具 ${r.tool_calls} 次</dd>
        <dt>Token / 成本</dt><dd>入 ${num(r.tokens_in)} · 出 ${num(r.tokens_out)} · ${money(r.cost_usd)}</dd>
        <dt>快照</dt><dd>${esc((r.snapshot && r.snapshot.collector) || '—')} · 模态 ${esc(((r.snapshot && r.snapshot.modalities) || byMod && Object.keys(byMod)).join?.(' / ') || Object.keys(byMod).join(' / '))}</dd>
      </dl>
    </div>
    <div class="card">
      <h2>观测信号构成</h2>
      <div id="c-mod" style="height:210px"></div>
      <div>${Object.entries(byMod).map(([m, n]) => `<span class="chip info">${esc(m)} ${n}</span>`).join('')}</div>
      ${(r.cases || []).length ? `<h3>关联案例</h3>${r.cases.map((c) => `<div><a href="#/case/${c.id}">${esc(c.case_key)} · ${esc(c.title)}</a> <span class="badge n">${esc(c.status)}</span></div>`).join('')}` : ''}
    </div>
  </div>

  <div class="card">
    <h2>执行链路（Trace 瀑布）</h2>
    ${spans.length ? `<div class="waterfall">${spans.map((s) => {
      const left = ((s.start_ms - t0) / span) * 100;
      const w = Math.max(0.6, ((s.duration_ms || 1) / span) * 100);
      const cls = s.kind === 'agent' ? 'agent' : s.kind === 'llm' ? 'llm' : (s.status === 'error' ? 'err' : '');
      return `<div class="wf-row"><div class="mono">${esc(s.name)}<span class="hint"> · ${esc(s.kind)}</span></div>
        <div class="wf-track"><div class="wf-bar ${cls}" style="left:${left}%;width:${w}%"></div></div>
        <div class="hint">${dur(s.duration_ms)}</div></div>`;
    }).join('')}</div>` : '<div class="empty">该运行没有上报 span</div>'}
  </div>

  <div class="grid g-2-1">
    <div class="card">
      <h2>信号明细（按时间）</h2>
      <div class="table-wrap" style="max-height:420px;overflow:auto"><table><thead><tr>
        <th>时间</th><th>模态</th><th>实体</th><th>名称</th><th>值 / 内容</th><th>级别</th></tr></thead><tbody>
      ${(r.signals || []).slice(0, 200).map((s) => `<tr>
        <td class="mono">${s.ts_ms ? new Date(s.ts_ms).toISOString().slice(11, 19) : '—'}</td>
        <td><span class="chip info">${esc(s.modality)}</span></td>
        <td class="mono">${esc(s.entity_key || '—')}</td>
        <td>${esc(s.name || '')}</td>
        <td>${s.value !== null && s.value !== undefined ? `<b>${s.value}</b>` : esc((s.text || '').slice(0, 90))}</td>
        <td><span class="chip ${s.severity === 'critical' || s.severity === 'error' ? 'err' : s.severity === 'warn' ? 'warn' : 'n'}">${esc(s.severity)}</span></td>
      </tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="card">
      <h2>事件时间线</h2>
      <div class="timeline">${(r.signals || []).filter((s) => ['log', 'event', 'alert'].includes(s.modality)).slice(0, 14).map((s) => `
        <div class="tl-item ${s.severity === 'critical' || s.severity === 'error' ? 'err' : s.severity === 'warn' ? 'warn' : ''}">
          <div class="mono hint">${esc(s.entity_key || '')} · ${esc(s.name || '')}</div>
          <div>${esc((s.text || '').slice(0, 120))}</div></div>`).join('')}</div>
    </div>
  </div>`;

  chart('c-mod', {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie', radius: ['42%', '68%'],
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      data: Object.entries(byMod).map(([m, n]) => ({ name: m, value: n })),
      color: ['#85b7eb', '#5dcaa5', '#ef9f27', '#afa9ec', '#f0997b', '#b4b2a9'],
    }],
  });
  $('#to-case').onclick = async () => {
    try {
      const c = await api('/cases', { method: 'POST', body: { source_run_id: Number(id), status: 'draft' } });
      toast('已沉淀为案例 ' + c.case_key + '，请复核四层真值');
      location.hash = '#/case/' + c.id;
    } catch (e) { toast('失败：' + e.message); }
  };
}

/* ------------------------------------------------------------------ 案例库 */

let caseFilter = { status: '', group: '', q: '' };

async function pageCases() {
  const [data, tax] = await Promise.all([
    api(`/cases?status=${encodeURIComponent(caseFilter.status)}&group=${encodeURIComponent(caseFilter.group)}&q=${encodeURIComponent(caseFilter.q)}`),
    api('/taxonomy'),
  ]);
  TAXONOMY = tax;
  const c = data.counts || {};
  $('#page-actions').innerHTML = `<button class="btn" id="batch-replay">批量回放（黄金案例）</button>`;
  $('#page').innerHTML = `
  <div class="grid g4">
    <div class="kpi"><div class="k">案例总数</div><div class="v">${num(c.total)}</div><div class="s">四层真值已标注</div></div>
    <div class="kpi"><div class="k">黄金案例</div><div class="v" style="color:var(--teal)">${num(c.golden)}</div><div class="s">通过 GSTO 门禁</div></div>
    <div class="kpi"><div class="k">BadCase</div><div class="v" style="color:var(--red)">${num(c.badcase)}</div><div class="s">回放未达阈值</div></div>
    <div class="kpi"><div class="k">草稿 / 候选</div><div class="v">${num(c.draft)}</div><div class="s">待人工复核</div></div>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="filters">
      <div><label>状态</label><select id="c-status"><option value="">全部</option>
        <option value="golden">golden</option><option value="badcase">badcase</option>
        <option value="draft">draft</option><option value="candidate">candidate</option>
        <option value="deprecated">deprecated</option></select></div>
      <div><label>故障组</label><select id="c-group"><option value="">全部</option>
        ${(tax.groups || []).map((g) => `<option value="${esc(g.group)}">${esc(g.group)}</option>`).join('')}</select></div>
      <div style="min-width:200px"><label>关键词</label><input id="c-q" value="${esc(caseFilter.q)}" /></div>
      <button class="btn primary" id="c-go">筛选</button>
      <button class="btn" id="c-reset">重置</button>
    </div>
    <div class="table-wrap"><table><thead><tr>
      <th>Case</th><th>故障类型</th><th>根因实体</th><th>难度</th><th>最新分</th>
      <th>定因/定界/过程</th><th>门禁</th><th>回放</th><th>状态</th><th>更新时间</th>
    </tr></thead><tbody>
    ${(data.items || []).length ? data.items.map((k) => {
      const q = k.quality || {};
      return `<tr class="clickable" onclick="location.hash='#/case/${k.id}'">
      <td><b>${esc(k.case_key)}</b><div class="hint">${esc((k.title || '').slice(0, 32))}</div></td>
      <td>${esc(k.fault_type || '—')}<div class="hint">${esc(k.fault_group || '')}</div></td>
      <td class="mono">${esc(k.root_cause_entity || k.entity_key || '—')}</td>
      <td><span class="chip n">${esc(k.difficulty)}</span></td>
      <td><span class="score-pill s-${k.last_verdict || 'error'}">${(k.last_score || 0).toFixed(2)}</span></td>
      <td class="hint">${(k.score_fault || 0).toFixed(2)} / ${(k.score_entity || 0).toFixed(2)} / ${(k.score_process || 0).toFixed(2)}</td>
      <td>${q.passed ? '<span class="chip ok">通过</span>' : `<span class="chip warn">${(q.checks || []).filter((x) => x.passed).length}/4</span>`}</td>
      <td>${k.replay_count || 0}</td>
      <td><span class="chip ${k.status === 'golden' ? 'ok' : k.status === 'badcase' ? 'err' : 'n'}">${esc(k.status)}</span></td>
      <td class="hint">${dt(k.updated_at)}</td></tr>`;
    }).join('') : '<tr><td colspan="10"><div class="empty">暂无案例，去运行记录里「沉淀为案例」</div></td></tr>'}
    </tbody></table></div>
  </div>`;
  $('#c-status').value = caseFilter.status;
  $('#c-group').value = caseFilter.group;
  $('#c-go').onclick = () => { caseFilter = { status: $('#c-status').value, group: $('#c-group').value, q: $('#c-q').value.trim() }; router(); };
  $('#c-reset').onclick = () => { caseFilter = { status: '', group: '', q: '' }; router(); };
  $('#batch-replay').onclick = async () => {
    toast('正在回放黄金案例集…');
    try {
      const r = await api('/replay/suite', { method: 'POST', body: { status: 'golden', mode: 'offline', agent_version: 'manual' } });
      toast(`回放 ${r.total} 个案例，通过 ${r.passed}（${pct(r.pass_rate)}），均分 ${r.avg_score}`);
      router();
    } catch (e) { toast('失败：' + e.message); }
  };
}

async function pageCaseDetail(id) {
  const c = await api('/cases/' + id);
  const tax = TAXONOMY || (TAXONOMY = await api('/taxonomy'));
  const types = [];
  (tax.groups || []).forEach((g) => g.types.forEach((t) => types.push(t.type)));
  const q = c.quality || {};
  $('#page-actions').innerHTML = `
    <button class="btn" id="gate">运行门禁</button>
    <button class="btn" id="gold">标记黄金</button>
    <button class="btn danger" id="bad">标记 BadCase</button>
    <button class="btn" id="export">导出案例包</button>`;
  $('#page').innerHTML = `
  <div class="grid g-2-1">
    <div class="card">
      <div class="section-title"><h2>${esc(c.case_key)} · ${esc(c.title)}</h2>
        <span class="chip ${c.status === 'golden' ? 'ok' : c.status === 'badcase' ? 'err' : 'n'}">${esc(c.status)}</span></div>
      <h3>四层真值标注</h3>
      <div class="grid g2">
        <div>
          <label>L1 故障类型（规范词表，决定「定因」40%）</label>
          <input id="a-fault" list="fault-types" value="${esc(c.fault_type || '')}" />
          <datalist id="fault-types">${types.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
          <div class="hint">当前归组：<b>${esc(c.fault_group || '未识别')}</b></div>
        </div>
        <div>
          <label>L2 归一化根因实体（决定「定界」30%）</label>
          <input id="a-entity" list="entity-keys" value="${esc(c.root_cause_entity || '')}" />
          <div class="hint">归一化后：<span class="mono">${esc(c.entity_key || '—')}</span></div>
        </div>
      </div>
      <label>L3 因果传播链（每行一步，按发生顺序，决定「过程」的 60%）</label>
      <textarea id="a-chain" rows="5">${esc((c.causal_chain || []).join('\n'))}</textarea>
      <label>L4 关键证据检查点（JSON 数组，决定「过程」的 40%）</label>
      <textarea id="a-evidence" rows="6">${esc(JSON.stringify(c.evidence || [], null, 2))}</textarea>
      <div class="grid g3">
        <div><label>难度</label><select id="a-diff">
          ${['L1', 'L2', 'L3', 'L4'].map((d) => `<option value="${d}" ${c.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
        <div><label>状态</label><select id="a-status">
          ${['draft', 'candidate', 'golden', 'badcase', 'deprecated'].map((s) => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div><label>标签（逗号分隔）</label><input id="a-tags" value="${esc((c.tags || []).join(','))}" /></div>
      </div>
      <label>备注</label><input id="a-notes" value="${esc(c.notes || '')}" />
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn primary" id="save">保存标注</button>
        <button class="btn" id="replay-offline">离线回放</button>
        <button class="btn" id="replay-live">实时回放（调 Agent 端点）</button>
      </div>
    </div>
    <div>
      <div class="card">
        <h2>GSTO 质量门禁</h2>
        <div>${(q.checks || []).map((k) => `<div style="padding:6px 0;border-bottom:1px solid var(--border)">
          <span class="chip ${k.passed ? 'ok' : 'err'}">${k.passed ? '通过' : '未过'}</span> <b>${esc(k.name)}</b>
          <div class="hint">${esc(k.note)}</div></div>`).join('') || '<div class="empty">尚未运行门禁</div>'}</div>
      </div>
      <div class="card">
        <h2>回放历史</h2>
        ${(c.history || []).length ? `<div class="table-wrap"><table><thead><tr><th>时间</th><th>模式</th><th>分数</th><th>Δ</th></tr></thead><tbody>
          ${c.history.map((h) => `<tr><td class="hint">${dt(h.created_at)}</td><td><span class="chip info">${esc(h.mode)}</span></td>
            <td><span class="score-pill s-${h.verdict}">${(h.score || 0).toFixed(2)}</span></td>
            <td class="hint">${h.delta === null ? '—' : (h.delta > 0 ? '+' : '') + h.delta.toFixed(3)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">还没有回放记录</div>'}
      </div>
      <div class="card">
        <h2>关联优化建议</h2>
        ${(c.optimizations || []).length ? c.optimizations.map((o) => `<div style="padding:4px 0"><a href="#/optimize">${esc(o.title)}</a> <span class="chip n">${esc(o.status)}</span></div>`).join('')
          : '<div class="empty">暂无，去优化台点一次分析</div>'}
      </div>
    </div>
  </div>

  <div class="grid g2">
    <div class="card">
      <h2>回放输入快照（Agent 可见部分，不含真值）</h2>
      <div class="hint">共 ${(c.signals || []).length} 条信号 · 模态 ${[...new Set((c.signals || []).map((s) => s.modality))].join(' / ')}</div>
      <div class="table-wrap" style="max-height:300px;overflow:auto"><table><thead><tr><th>模态</th><th>实体</th><th>名称</th><th>值</th></tr></thead><tbody>
      ${(c.signals || []).slice(0, 80).map((s) => `<tr><td><span class="chip info">${esc(s.modality)}</span></td>
        <td class="mono">${esc(s.entity_key)}</td><td>${esc(s.name)}</td>
        <td>${s.value !== null && s.value !== undefined ? s.value : esc((s.text || '').slice(0, 60))}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="card">
      <h2>最新回放评分拆解</h2>
      ${c.latest_run ? `<div id="c-score" style="height:250px"></div>` : '<div class="empty">还没有回放</div>'}
    </div>
  </div>`;

  const save = async () => {
    let evidence = [];
    try { evidence = JSON.parse($('#a-evidence').value || '[]'); }
    catch (e) { toast('证据检查点不是合法 JSON'); return; }
    const body = {
      title: c.title, fault_type: $('#a-fault').value.trim(), root_cause_entity: $('#a-entity').value.trim(),
      causal_chain: $('#a-chain').value.split('\n').map((s) => s.trim()).filter(Boolean),
      evidence, difficulty: $('#a-diff').value, status: $('#a-status').value,
      tags: $('#a-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
      notes: $('#a-notes').value,
    };
    try {
      const updated = await api('/cases/' + id, { method: 'PUT', body });
      toast('已保存，门禁：' + (updated.quality.passed ? '通过' : '未通过'));
      router();
    } catch (e) { toast('保存失败：' + e.message); }
  };
  $('#save').onclick = save;
  $('#gate').onclick = async () => {
    const g = await api('/cases/' + id + '/gate', { method: 'POST', body: {} });
    toast(g.passed ? '门禁通过，可沉淀为黄金案例' : '门禁未过：' + g.checks.filter((x) => !x.passed).map((x) => x.name).join('、'));
    router();
  };
  $('#gold').onclick = async () => {
    try { await api('/cases/' + id + '/status', { method: 'POST', body: { status: 'golden' } }); toast('已沉淀为黄金案例'); router(); }
    catch (e) { toast('失败：' + e.message); }
  };
  $('#bad').onclick = async () => {
    await api('/cases/' + id + '/status', { method: 'POST', body: { status: 'badcase' } });
    toast('已标记 BadCase'); router();
  };
  $('#export').onclick = async () => {
    const data = await api('/cases/' + id + '/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = c.case_key + '.json';
    a.click();
    toast('已导出案例包（含四层真值 + 快照索引）');
  };
  const doReplay = async (mode) => {
    toast('回放中…');
    try {
      const r = await api('/replay/case/' + id, { method: 'POST', body: { mode, agent_version: 'manual' } });
      if (r.error) toast('回放异常：' + r.error);
      else toast(`回放完成：${r.verdict} · 综合 ${r.score.toFixed(3)}（定因 ${r.score_fault} / 定界 ${r.score_entity} / 过程 ${r.score_process}）`);
      router();
    } catch (e) { toast('回放失败：' + e.message); }
  };
  $('#replay-offline').onclick = () => doReplay('offline');
  $('#replay-live').onclick = () => doReplay('live');

  if (c.latest_run) {
    const lr = c.latest_run;
    const d = lr.detail || {};
    chart('c-score', {
      tooltip: { trigger: 'item' },
      series: [{
        type: 'bar', barMaxWidth: 34, label: { show: true, position: 'top', fontSize: 11 },
        data: [
          { name: '定因 40%', value: lr.score_fault, itemStyle: { color: '#185fa5' } },
          { name: '定界 30%', value: lr.score_entity, itemStyle: { color: '#0f6e56' } },
          { name: '过程 30%', value: lr.score_process, itemStyle: { color: '#854f0b' } },
          { name: '综合', value: lr.score, itemStyle: { color: '#534ab7' } },
        ],
        xAxis: undefined,
      }],
      xAxis: { type: 'category', data: ['定因 40%', '定界 30%', '过程 30%', '综合'], axisLabel: { color: '#6b7280' }, axisLine: { lineStyle: { color: '#e3e7ec' } } },
      yAxis: { type: 'value', max: 1, splitLine: { lineStyle: { color: '#eef1f4' } }, axisLabel: { color: '#6b7280' } },
    });
  }
  const tbl = $('#page');
  if (c.latest_run && c.latest_run.detail) {
    const notes = [];
    const d = c.latest_run.detail;
    ['fault', 'entity', 'chain', 'evidence'].forEach((k) => { if (d[k]) notes.push(`${d[k].note}`); });
    tbl.insertAdjacentHTML('beforeend', `<div class="card"><h2>评分依据（确定性可复现）</h2>
      <ul class="step-list">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <div class="hint">综合分 = 定因 × 40% + 定界 × 30% + 过程 × 30%；过程 = 链路 × 60% + 证据 × 40%。</div></div>`);
  }
}

/* ------------------------------------------------------------------ 回放 */

async function pageReplay() {
  const [cases, dims] = await Promise.all([api('/cases?limit=500'), api('/stats/dimensions')]);
  const items = cases.items || [];
  $('#page-actions').innerHTML = `<button class="btn primary" id="run-suite">运行回放</button>`;
  $('#page').innerHTML = `
  <div class="card">
    <h2>回放配置</h2>
    <div class="filters">
      <div><label>案例范围</label><select id="r-scope">
        <option value="golden">黄金案例（回归集）</option>
        <option value="badcase">BadCase（待修复集）</option>
        <option value="all">全部案例</option>
        <option value="selected">手动勾选</option>
      </select></div>
      <div><label>回放模式</label><select id="r-mode">
        <option value="offline">offline（用快照录制作答，验证打分链路与基线）</option>
        <option value="live">live（调用 Agent 端点，真实评测）</option>
      </select></div>
      <div><label>Agent 版本标记</label><input id="r-version" value="manual" /></div>
    </div>
    <div class="hint">live 模式会 POST 到「设置」中的 agent_endpoint，请求体含任务描述与观测数据摘要（不含真值），期望返回 {fault_type, entity, causal_chain, evidence}。</div>
  </div>

  <div class="grid g2">
    <div class="card"><h2>各模式平均分（定因 / 定界 / 过程）</h2><div id="c-dims" style="height:280px"></div></div>
    <div class="card"><h2>案例清单</h2>
      <div class="table-wrap" style="max-height:300px;overflow:auto"><table><thead><tr>
        <th><input type="checkbox" id="chk-all" style="width:auto" /></th><th>Case</th><th>状态</th><th>故障类型</th><th>最新分</th></tr></thead><tbody>
      ${items.map((k) => `<tr><td><input type="checkbox" class="chk" value="${k.id}" style="width:auto" /></td>
        <td><a href="#/case/${k.id}">${esc(k.case_key)}</a></td>
        <td><span class="chip ${k.status === 'golden' ? 'ok' : k.status === 'badcase' ? 'err' : 'n'}">${esc(k.status)}</span></td>
        <td>${esc(k.fault_type || '—')}</td>
        <td><span class="score-pill s-${k.last_verdict || 'error'}">${(k.last_score || 0).toFixed(2)}</span></td></tr>`).join('')}
      </tbody></table></div>
    </div>
  </div>
  <div class="card" id="suite-result"></div>`;

  $('#chk-all').onchange = (e) => $$('.chk').forEach((c) => { c.checked = e.target.checked; });
  const dm = dims.items || [];
  if (dm.length) {
    chart('c-dims', {
      tooltip: { trigger: 'axis' },
      legend: { data: ['定因', '定界', '过程', '综合'] },
      xAxis: { type: 'category', data: dm.map((d) => d.mode + ' (' + d.n + ')'), axisLabel: { color: '#6b7280' }, axisLine: { lineStyle: { color: '#e3e7ec' } } },
      yAxis: { type: 'value', max: 1, splitLine: { lineStyle: { color: '#eef1f4' } }, axisLabel: { color: '#6b7280' } },
      series: [
        { name: '定因', type: 'bar', data: dm.map((d) => d.fault), itemStyle: { color: '#85b7eb' } },
        { name: '定界', type: 'bar', data: dm.map((d) => d.entity), itemStyle: { color: '#5dcaa5' } },
        { name: '过程', type: 'bar', data: dm.map((d) => d.process), itemStyle: { color: '#ef9f27' } },
        { name: '综合', type: 'line', data: dm.map((d) => d.score), itemStyle: { color: '#534ab7' } },
      ],
    });
  } else {
    $('#c-dims').innerHTML = '<div class="empty">还没有回放数据</div>';
  }

  $('#run-suite').onclick = async () => {
    const scope = $('#r-scope').value;
    const body = { mode: $('#r-mode').value, agent_version: $('#r-version').value };
    if (scope === 'selected') {
      body.case_ids = $$('.chk').filter((c) => c.checked).map((c) => Number(c.value));
      if (!body.case_ids.length) { toast('请先勾选案例'); return; }
    } else if (scope !== 'all') {
      body.status = scope;
    } else {
      body.case_ids = items.map((i) => i.id);
    }
    toast('回放中…');
    try {
      const r = await api('/replay/suite', { method: 'POST', body });
      $('#suite-result').innerHTML = `
        <div class="section-title"><h2>回放结果</h2><span class="hint">通过 ${r.passed}/${r.total} · 通过率 ${pct(r.pass_rate)} · 均分 ${r.avg_score}</span></div>
        ${r.regressions.length ? `<div class="chip err">检出 ${r.regressions.length} 个回归（分数下降 > 0.05）</div>` : '<div class="chip ok">无回归</div>'}
        <div class="table-wrap"><table><thead><tr><th>Case</th><th>模式</th><th>结论</th><th>综合</th><th>定因</th><th>定界</th><th>过程</th><th>基线</th><th>Δ</th></tr></thead><tbody>
        ${r.results.map((x) => `<tr><td><a href="#/case/${x.case_id}">${esc(x.case_key)}</a></td>
          <td><span class="chip info">${esc(x.mode)}</span></td>
          <td><span class="score-pill s-${x.verdict}">${esc(x.verdict)}</span></td>
          <td>${x.score.toFixed(3)}</td><td>${x.score_fault.toFixed(2)}</td><td>${x.score_entity.toFixed(2)}</td><td>${x.score_process.toFixed(2)}</td>
          <td class="hint">${x.baseline_score === null ? '—' : x.baseline_score.toFixed(3)}</td>
          <td class="${x.delta < 0 ? '' : ''}" style="color:${x.delta < 0 ? 'var(--red)' : 'var(--teal)'}">${x.delta === null ? '—' : (x.delta > 0 ? '+' : '') + x.delta.toFixed(3)}</td></tr>`).join('')}
        </tbody></table></div>`;
      toast(`回放完成：通过 ${r.passed}/${r.total}，均分 ${r.avg_score}`);
    } catch (e) { toast('回放失败：' + e.message); }
  };
}

/* ------------------------------------------------------------------ 优化台 */

async function pageOptimize() {
  const [opts, clusters] = await Promise.all([
    api('/optimizations'), api('/optimize/analyze', { method: 'POST', body: {} }),
  ]);
  $('#page-actions').innerHTML = `<button class="btn primary" id="analyze">重新分析 BadCase</button>`;
  const draft = (opts || []).filter((o) => o.status === 'draft');
  $('#nav-opt-badge').textContent = draft.length;
  $('#nav-opt-badge').classList.toggle('hidden', !draft.length);

  $('#page').innerHTML = `
  <div class="grid g4">
    <div class="kpi"><div class="k">参与分析的 BadCase</div><div class="v">${num(clusters.badcase_count)}</div><div class="s">状态为 badcase 的案例</div></div>
    <div class="kpi"><div class="k">失分簇</div><div class="v">${num((clusters.clusters || []).length)}</div><div class="s">按故障组 × 失分维度聚类</div></div>
    <div class="kpi"><div class="k">建议总数</div><div class="v">${num(opts.length)}</div><div class="s">待确认 ${draft.length}</div></div>
    <div class="kpi"><div class="k">已提交 PR</div><div class="v">${num(opts.filter((o) => o.status === 'submitted').length)}</div><div class="s">在 GitHub 上评审</div></div>
  </div>

  <div class="card" style="margin-top:14px">
    <h2>失分簇（故障组 × 失分维度）</h2>
    ${(clusters.clusters || []).length ? `<div class="table-wrap"><table><thead><tr><th>故障组</th><th>主要失分</th><th>案例数</th><th>平均分</th><th>涉及案例</th></tr></thead><tbody>
      ${clusters.clusters.map((c) => `<tr><td><span class="chip info">${esc(c.fault_group)}</span></td>
        <td><span class="chip warn">${esc({ fault: '定因', entity: '定界', chain: '过程·因果链', evidence: '过程·证据', unknown: '未回放' }[c.weak_dimension] || c.weak_dimension)}</span></td>
        <td>${c.count}</td><td>${c.avg_score.toFixed(3)}</td>
        <td class="hint">${c.cases.map((x) => `<a href="#/case/${x.id}">${esc(x.case_key)}</a>`).join('、')}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">没有 BadCase 可供分析，先把回放未达标的案例标记为 badcase</div>'}
  </div>

  <h2 style="margin:18px 0 10px">优化建议（确认后提交到 GitHub）</h2>
  <div id="opt-list">${(opts || []).map(renderOptCard).join('') || '<div class="card"><div class="empty">暂无建议</div></div>'}</div>`;

  $('#analyze').onclick = async () => {
    const r = await api('/optimize/analyze', { method: 'POST', body: {} });
    toast(`分析完成：${r.badcase_count} 个 BadCase → 新增 ${r.created} 条建议`);
    router();
  };
  bindOptActions();
}

function diffHtml(patch) {
  return (patch || '（无 diff）').split('\n').map((l) => {
    if (l.startsWith('+++') || l.startsWith('---')) return `<span class="hunk">${esc(l)}</span>`;
    if (l.startsWith('@@')) return `<span class="hunk">${esc(l)}</span>`;
    if (l.startsWith('+')) return `<span class="add">${esc(l)}</span>`;
    if (l.startsWith('-')) return `<span class="del">${esc(l)}</span>`;
    return esc(l);
  }).join('\n');
}

function renderOptCard(o) {
  const statusChip = { draft: '<span class="chip warn">待确认</span>', approved: '<span class="chip info">已确认</span>',
    submitted: '<span class="chip ok">已提交 PR</span>', rejected: '<span class="chip n">已拒绝</span>' }[o.status] || '';
  return `<div class="card" data-opt="${o.id}">
    <div class="section-title">
      <h2>#${o.id} ${esc(o.title)}</h2>
      <div>${statusChip} <span class="chip info">${esc(o.category)}</span></div>
    </div>
    <div class="hint mono">目标文件：${esc(o.target_path)}</div>
    <p style="margin-top:8px">${esc(o.rationale)}</p>
    ${o.cases && o.cases.length ? `<div style="margin:6px 0">关联案例：${o.cases.map((c) => `<a class="chip info" href="#/case/${c.id}">${esc(c.case_key)}</a>`).join('')}</div>` : ''}
    <details style="margin-top:8px"><summary style="cursor:pointer">查看 diff</summary><pre class="diff">${diffHtml(o.patch)}</pre></details>
    <details style="margin-top:8px"><summary style="cursor:pointer">编辑补丁内容（确认前可改）</summary>
      <textarea rows="8" class="opt-content" data-opt="${o.id}">${esc(o.new_content || '')}</textarea></details>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn sm primary" data-act="save" data-opt="${o.id}">保存修改</button>
      <button class="btn sm ok" data-act="approve" data-opt="${o.id}">确认建议</button>
      <button class="btn sm danger" data-act="reject" data-opt="${o.id}">拒绝</button>
      <button class="btn sm" data-act="submit" data-opt="${o.id}">提交到 GitHub（新分支 + PR）</button>
    </div>
    ${o.gh_pr ? `<div style="margin-top:8px">分支 <span class="mono">${esc(o.gh_branch)}</span> · PR <a href="${esc(o.gh_pr.startsWith('http') ? o.gh_pr : '')}" target="_blank">#${esc(o.gh_pr)}</a></div>` : ''}
  </div>`;
}

function bindOptActions() {
  $$('[data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.opt;
      const act = btn.dataset.act;
      const card = $(`[data-opt="${id}"].card`);
      const content = card ? $('.opt-content', card) : null;
      try {
        if (act === 'save' || act === 'approve') {
          const body = { new_content: content ? content.value : undefined };
          if (act === 'approve') body.status = 'approved';
          await api('/optimizations/' + id, { method: 'PUT', body });
          toast(act === 'approve' ? '已确认该建议，可提交 GitHub' : '已保存修改');
          router();
        } else if (act === 'reject') {
          await api('/optimizations/' + id, { method: 'PUT', body: { status: 'rejected' } });
          toast('已拒绝'); router();
        } else if (act === 'submit') {
          if (content) await api('/optimizations/' + id, { method: 'PUT', body: { new_content: content.value } });
          toast('正在创建分支并提交 PR…');
          const r = await api('/optimizations/' + id + '/submit', { method: 'POST', body: {} });
          modal(`<h2>已提交到 GitHub</h2>
            <dl class="kv">
              <dt>仓库</dt><dd class="mono">${esc(r.base)} ← ${esc(r.branch)}</dd>
              <dt>Pull Request</dt><dd><a href="${esc(r.pr_url)}" target="_blank">${esc(r.pr_url)}</a></dd>
              <dt>提交文件</dt><dd>${r.files.map((f) => `<div class="mono">${esc(f.path)}</div>`).join('')}</dd>
            </dl>
            <p class="hint">合并该 PR 即发布新版本；合入后可在「回放评测」里跑黄金案例集验证是否真正改善。</p>
            <button class="btn primary" onclick="closeModal()">知道了</button>`);
          router();
        }
      } catch (e) { toast('操作失败：' + e.message); }
    };
  });
}

/* ------------------------------------------------------------------ 实体语义 */

async function pageEntities() {
  const [ents, topo, tax] = await Promise.all([api('/entities'), api('/entities/topology'), api('/taxonomy')]);
  $('#page-actions').innerHTML = `<button class="btn primary" id="add-entity">登记实体</button>`;
  $('#page').innerHTML = `
  <div class="grid g-2-1">
    <div class="card"><h2>实体拓扑图（归一化后的跨域标识）</h2><div id="c-topo" style="height:360px"></div></div>
    <div class="card"><h2>统计</h2>
      <div class="kpi" style="margin-bottom:10px"><div class="k">实体数</div><div class="v">${(ents.items || []).length}</div><div class="s">边 ${topo.links.length} 条</div></div>
      <h3>故障分类树（受控词表）</h3>
      ${(tax.groups || []).map((g) => `<div style="margin-bottom:6px"><span class="chip info">${esc(g.group)}</span>
        <span class="hint">${g.types.map((t) => esc(t.type)).join(' · ')}</span></div>`).join('')}
    </div>
  </div>
  <div class="card">
    <h2>实体清单</h2>
    <div class="table-wrap"><table><thead><tr>
      <th>entity_key（统一主键）</th><th>canonical</th><th>类型</th><th>层</th><th>父实体</th><th>别名（其他系统口径）</th><th>度数</th>
    </tr></thead><tbody>
    ${(ents.items || []).map((e) => `<tr><td class="mono"><b>${esc(e.entity_key)}</b></td>
      <td>${esc(e.canonical)}</td><td><span class="chip n">${esc(e.etype)}</span></td><td>${esc(e.layer)}</td>
      <td class="mono">${esc(e.parent_key || '—')}</td>
      <td class="hint mono">${esc((e.aliases || []).join(' / ') || '—')}</td><td>${e.degree}</td></tr>`).join('')}
    </tbody></table></div>
  </div>`;
  const nodes = (ents.items || []).map((e) => ({
    name: e.entity_key, value: e.degree, symbolSize: 12 + Math.min(20, e.degree * 2),
    category: ['service', 'middleware', 'k8s', 'cloud', 'pod', 'node', 'redis', 'mysql', 'kafka'].indexOf(e.etype) % 5,
    label: { show: true, fontSize: 10 },
  }));
  chart('c-topo', {
    tooltip: {},
    legend: { data: ['服务', '中间件', '容器域', '云资源', '其他'], bottom: 0 },
    series: [{
      type: 'graph', layout: 'force', roam: true, draggable: true,
      force: { repulsion: 260, edgeLength: 90, gravity: 0.08 },
      categories: [{ name: '服务' }, { name: '中间件' }, { name: '容器域' }, { name: '云资源' }, { name: '其他' }],
      label: { color: '#1f2328' },
      lineStyle: { color: '#c9d3dd', width: 1 },
      data: nodes, links: topo.links,
    }],
  });
  $('#add-entity').onclick = () => {
    modal(`<h2>登记实体（补齐跨域映射）</h2>
      <div class="grid g2">
        <div><label>entity_key（统一主键）</label><input id="e-key" placeholder="checkout-db" /></div>
        <div><label>类型</label><input id="e-type" value="service" /></div>
      </div>
      <div class="grid g2">
        <div><label>父实体</label><input id="e-parent" placeholder="checkout-service" /></div>
        <div><label>别名（逗号分隔）</label><input id="e-alias" placeholder="prod-checkout-db:3306" /></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px"><button class="btn primary" id="e-save">保存</button>
      <button class="btn" onclick="closeModal()">取消</button></div>`);
    $('#e-save').onclick = async () => {
      await api('/entities', { method: 'POST', body: {
        entity_key: $('#e-key').value, etype: $('#e-type').value, parent_key: $('#e-parent').value,
        aliases: $('#e-alias').value.split(',').map((s) => s.trim()).filter(Boolean),
      } });
      closeModal(); toast('已登记'); router();
    };
  };
}

/* ------------------------------------------------------------------ 设置 */

async function pageSettings() {
  const [s, tokens, audit] = await Promise.all([api('/settings'), api('/tokens'), api('/audit?limit=30')]);
  const origin = location.origin;
  $('#page').innerHTML = `
  <div class="grid g2">
    <div class="card">
      <h2>GitHub 集成（提交优化补丁用）</h2>
      <label>Personal Access Token（repo 权限）</label>
      <input id="s-gh-token" placeholder="${s.github_token_set ? '已配置（' + esc(s.github_token || '') + '），留空则不修改' : 'ghp_xxx'}" />
      <div class="grid g2">
        <div><label>owner</label><input id="s-gh-owner" value="${esc(s.github_owner || '')}" /></div>
        <div><label>repo</label><input id="s-gh-repo" value="${esc(s.github_repo || '')}" /></div>
      </div>
      <label>基线分支</label><input id="s-gh-base" value="${esc(s.github_base_branch || 'main')}" />
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn primary" id="s-save-gh">保存</button>
        <button class="btn" id="s-verify-gh">校验连通性</button>
      </div>
      <div class="hint" id="gh-verify-result" style="margin-top:8px"></div>
    </div>

    <div class="card">
      <h2>被测 Agent 端点（live 回放）</h2>
      <label>agent_endpoint（POST，返回 prediction）</label>
      <input id="s-agent-ep" value="${esc(s.agent_endpoint || '')}" placeholder="http://127.0.0.1:9000/diagnose" />
      <label>agent_token（可选）</label>
      <input id="s-agent-token" placeholder="${s.agent_token_set ? '已配置，留空则不修改' : '可选'}" />
      <label>默认 skill / prompt 目录名</label>
      <input id="s-default-agent" value="${esc(s.default_agent || 'ops-agent')}" />
      <div style="margin-top:12px"><button class="btn primary" id="s-save-agent">保存</button></div>

      <h3>本地 Agent 上报 SDK</h3>
      <div class="code-block">pip install -e sdk/
harness login --endpoint ${origin} --token &lt;API_TOKEN&gt;
harness record -- python my_agent.py      # 录制 trace/metrics/logs 快照
harness report --run-id &lt;id&gt;             # 上报到平台
harness case create --run-id &lt;id&gt;        # 沉淀为案例</div>
    </div>
  </div>

  <div class="card">
    <h2>API Token（SDK 上报凭证）</h2>
    <div class="table-wrap"><table><thead><tr><th>名称</th><th>Token</th><th>创建时间</th><th>最近使用</th><th>操作</th></tr></thead><tbody>
    ${tokens.map((t) => `<tr><td>${esc(t.name)}</td><td class="mono">${esc(t.token_masked)}</td>
      <td class="hint">${dt(t.created_at)}</td><td class="hint">${dt(t.last_used_at)}</td>
      <td>${t.revoked ? '<span class="chip n">已吊销</span>' : `<button class="btn sm danger" onclick="revokeToken(${t.id})">吊销</button>`}</td></tr>`).join('')}
    </tbody></table></div>
    <div style="margin-top:10px;display:flex;gap:8px">
      <input id="t-name" placeholder="新 Token 名称，例如 ci-runner" style="max-width:260px" />
      <button class="btn primary" id="t-create">生成 Token</button>
    </div>
  </div>

  <div class="card">
    <h2>操作审计（谁改了四层真值、谁提交了 PR）</h2>
    <div class="table-wrap"><table><thead><tr><th>时间</th><th>动作</th><th>对象</th><th>详情</th></tr></thead><tbody>
    ${audit.map((a) => `<tr><td class="hint">${dt(a.created_at)}</td><td><span class="chip info">${esc(a.action)}</span></td>
      <td class="mono">${esc(a.target || '')}</td><td class="hint">${esc(JSON.stringify(a.detail || {}).slice(0, 120))}</td></tr>`).join('')}
    </tbody></table></div>
  </div>`;

  $('#s-save-gh').onclick = async () => {
    await api('/settings', { method: 'PUT', body: {
      github_token: $('#s-gh-token').value, github_owner: $('#s-gh-owner').value,
      github_repo: $('#s-gh-repo').value, github_base_branch: $('#s-gh-base').value,
    } });
    toast('已保存'); router();
  };
  $('#s-verify-gh').onclick = async () => {
    try {
      const r = await api('/github/verify', { method: 'POST', body: {} });
      $('#gh-verify-result').innerHTML = `<span class="chip ok">连通</span> 账号 ${esc(r.login)} · 仓库 ${esc(r.repo)} · 默认分支 ${esc(r.default_branch)} · 写权限 ${r.permissions && r.permissions.push ? '有' : '无'}`;
    } catch (e) { $('#gh-verify-result').innerHTML = `<span class="chip err">失败</span> ${esc(e.message)}`; }
  };
  $('#s-save-agent').onclick = async () => {
    await api('/settings', { method: 'PUT', body: {
      agent_endpoint: $('#s-agent-ep').value,
      agent_token: $('#s-agent-token').value,
      default_agent: $('#s-default-agent').value,
    } });
    toast('已保存'); router();
  };
  $('#t-create').onclick = async () => {
    const r = await api('/tokens', { method: 'POST', body: { name: $('#t-name').value || 'sdk' } });
    modal(`<h2>Token 已生成（仅显示一次）</h2><div class="code-block">${esc(r.token)}</div>
      <p class="hint">把它写进本地上报 SDK：<span class="mono">harness login --endpoint ${origin} --token ${esc(r.token)}</span></p>
      <button class="btn primary" onclick="closeModal();location.reload()">知道了</button>`);
  };
  window.revokeToken = async (id) => { await api('/tokens/' + id, { method: 'DELETE' }); toast('已吊销'); router(); };
}

/* ------------------------------------------------------------ 监控告警 */

const ALERT_WINDOWS = [[1, '1 小时', '1h'], [24, '24 小时', '24h'], [168, '7 天', '7d']];
let ALERT_WINDOW = Number(localStorage.getItem('harness_alert_window') || 24);
if (!ALERT_WINDOWS.some((w) => w[0] === ALERT_WINDOW)) ALERT_WINDOW = 24;

const AGENT_STATUS_CHIP = {
  healthy: ['ok', '健康'],
  degraded: ['warn', '退化'],
  silent: ['err', '静默'],
};

function alertRefs(a) {
  if (!a.refs || !a.refs.length) return '';
  const items = a.refs.slice(0, 6).map((r) => {
    if (a.rule_key === 'agent_silent') {
      return `<span class="chip">${esc(r.agent)} · 最后上报 ${esc(dt(r.last_seen) || '从未')}</span>`;
    }
    if (r.case_key && r.verdict) {
      return `<a href="#/case/${r.case_id}" class="chip">${esc(r.case_key)} · ${esc(r.verdict)} ${r.score === null || r.score === undefined ? '' : Number(r.score).toFixed(3)}</a>`;
    }
    if (r.case_key) {
      return `<a href="#/case/${r.id}" class="chip">${esc(r.case_key)} · ${esc(r.fault_type || '')}</a>`;
    }
    const suffix = r.value !== undefined && r.value !== null ? ' · ' + esc(String(r.value)) : (r.error_type ? ' · ' + esc(r.error_type) : '');
    return `<a href="#/run/${r.id}" class="chip">${esc(r.external_run_id || ('run ' + r.id))}${suffix}</a>`;
  });
  return `<div class="alert-refs">${items.join('')}</div>`;
}

async function pageAlerts() {
  const ev = await api('/alerts?window_hours=' + ALERT_WINDOW);
  const s = ev.summary, m = ev.metrics;

  $('#page-actions').innerHTML =
    `<div class="win-tabs">${ALERT_WINDOWS.map(([h, label]) =>
      `<button data-h="${h}" class="${ALERT_WINDOW === h ? 'active' : ''}">${label}</button>`).join('')}</div>
     <button class="btn" id="refresh-alerts">重新评估</button>`;
  $$('#page-actions .win-tabs button').forEach((b) => {
    b.onclick = () => {
      ALERT_WINDOW = Number(b.dataset.h);
      localStorage.setItem('harness_alert_window', String(ALERT_WINDOW));
      router();
    };
  });
  $('#refresh-alerts').onclick = () => router();

  const sev = (k) => s[k] || 0;
  const kpi = (k, v, sub) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;

  const healthRows = ev.agent_health.map((h) => {
    const [cls, zh] = AGENT_STATUS_CHIP[h.status] || ['n', h.status];
    return `<tr>
      <td><b>${esc(h.agent)}</b><div class="hint">${esc(h.agent_type || '')}${h.version ? ' · ' + esc(h.version) : ''}</div></td>
      <td><span class="chip ${cls}">${zh}</span></td>
      <td class="mono">${h.runs_in_window} / ${h.total_runs}</td>
      <td class="mono">${h.runs_in_window ? pct(h.success_rate) : '—'}</td>
      <td class="mono">${h.runs_in_window ? dur(h.avg_duration_ms) : '—'}</td>
      <td class="mono">${h.runs_in_window ? h.max_tool_calls : '—'}</td>
      <td class="mono">${money(h.cost_usd)}</td>
      <td class="hint">${esc(dt(h.last_seen) || '从未上报')}</td>
    </tr>`;
  }).join('');

  const alertCards = ev.alerts.length ? ev.alerts.map((a) => `
    <div class="alert-card ${a.severity} ${a.acknowledged ? 'acked' : ''}">
      <div class="alert-head">
        <div class="alert-title">
          <span class="sev sev-${a.severity}">${a.severity}</span>
          <span>${esc(a.name_zh)}</span>
          <span class="hint mono">${esc(a.rule_key)}</span>
          ${a.acknowledged ? '<span class="chip ok">已确认</span>' : ''}
        </div>
        <div class="alert-metric">
          <b>${esc(a.current_text)}</b> ${a.compare_zh} ${esc(a.threshold_text)}
          <span class="hint">· 样本 ${a.sample}${a.overridden ? ' · 阈值已自定义' : ''}</span>
        </div>
      </div>
      <div class="alert-body">${esc(a.desc_zh)}</div>
      <div class="alert-hint"><b>处置建议：</b>${esc(a.hint_zh)}</div>
      ${alertRefs(a)}
      <div style="margin-top:9px;display:flex;gap:8px">
        ${a.acknowledged
          ? `<button class="btn sm" data-unack="${esc(a.rule_key)}">取消确认</button>`
          : `<button class="btn sm" data-ack="${esc(a.rule_key)}" data-sig="${esc(a.signature)}">确认</button>`}
        <span class="hint" style="align-self:center">签名 <span class="mono">${esc(a.signature)}</span>——指标变化后会重新告警</span>
      </div>
    </div>`).join('') : '<div class="card"><div class="empty">当前时间窗内没有触发的告警 ✓</div></div>';

  const skipped = ev.skipped_rules.length
    ? `<div class="card"><h2>因样本不足跳过的规则（${ev.skipped_rules.length}）</h2>
        <p class="hint">比率类规则在样本太少时不下结论，避免用 1 次运行的成功率报警。</p>
        <div class="table-wrap"><table><thead><tr><th>规则</th><th>指标样本</th><th>最少需要</th></tr></thead><tbody>
        ${ev.skipped_rules.map((r) => `<tr><td>${esc(r.name_zh)} <span class="mono hint">${esc(r.rule_key)}</span></td>
          <td class="mono">${r.sample}</td><td class="mono">${r.min_samples}</td></tr>`).join('')}
        </tbody></table></div></div>` : '';

  const ruleRows = ev.rules.map((r) => `<tr>
      <td><b>${esc(r.name_zh)}</b><div class="hint mono">${esc(r.key)}</div></td>
      <td class="mono">${esc(r.metric)}</td>
      <td class="mono nowrap">${esc(r.metric)} ${r.op === 'lt' ? '<' : r.op === 'gt' ? '>' : r.op === 'gte' ? '≥' : r.op === 'lte' ? '≤' : '='} …</td>
      <td><input class="rule-num" type="number" step="any" data-rule="${esc(r.key)}" data-field="threshold" value="${r.threshold}" /></td>
      <td><select data-rule="${esc(r.key)}" data-field="severity">
        ${['critical', 'warning', 'info'].map((x) => `<option value="${x}" ${r.severity === x ? 'selected' : ''}>${x}</option>`).join('')}
      </select></td>
      <td><input type="checkbox" data-rule="${esc(r.key)}" data-field="enabled" ${r.enabled ? 'checked' : ''} style="width:auto" /></td>
      <td>${r.overridden ? '<span class="chip warn">已自定义</span>' : '<span class="hint">默认</span>'}</td>
    </tr>`).join('');

  $('#page').innerHTML = `
    <div class="doc-lead">
      监控的是「被测 Agent 这个系统本身」是否健康——它和「案例答得对不对」是两件事。
      全部规则都是确定性的：同一份数据、同一个时间窗，任何时候重新评估结果完全一致，因此可以直接接进 CI 做门禁。
      评估时间 <span class="mono">${esc(ev.evaluated_at)}</span>，窗口自 <span class="mono">${esc(ev.since)}</span>。
    </div>

    <div class="grid g4" style="margin-bottom:14px">
      ${kpi('严重告警', sev('critical'), '需要立即处置')}
      ${kpi('警告', sev('warning'), '需要关注')}
      ${kpi('提示', sev('info'), '信息类信号')}
      ${kpi('未确认', s.open, `共 ${s.total} 条，已确认 ${s.acknowledged}`)}
    </div>

    <div class="grid g4" style="margin-bottom:14px">
      ${kpi('窗口内运行', m.runs, `${m.success} 成功 / ${m.failed} 失败 / ${m.partial} 部分`)}
      ${kpi('成功率', m.runs ? pct(m.success_rate) : '—', `报错率 ${m.runs ? pct(m.error_rate) : '—'}`)}
      ${kpi('P95 耗时', m.runs ? dur(m.p95_duration_ms) : '—', `平均 ${m.runs ? dur(m.avg_duration_ms) : '—'}`)}
      ${kpi('回放通过率', m.replays ? pct(m.replay_pass_rate) : '—', `${m.replays} 次回放 · 均分 ${m.avg_score}`)}
    </div>

    <div class="card">
      <h2>Agent 健康快照</h2>
      <p class="hint">健康 = 窗口内有上报且成功率 ≥ 60%；退化 = 成功率低于 60%；静默 = 窗口内一条都没上报（可能接入断了）。</p>
      <div class="table-wrap"><table><thead><tr>
        <th>Agent</th><th>状态</th><th>运行（窗口/累计）</th><th>成功率</th><th>平均耗时</th><th>最大工具调用</th><th>成本</th><th>最后上报</th>
      </tr></thead><tbody>${healthRows || '<tr><td colspan="8" class="empty">还没有登记任何 Agent</td></tr>'}</tbody></table></div>
    </div>

    <h2 style="margin:16px 0 10px">触发的告警（${s.total}）</h2>
    ${alertCards}
    ${skipped}

    <div class="card" style="margin-top:14px">
      <h2>告警规则（可改阈值 / 严重度 / 启停）</h2>
      <p class="hint">规则语义不可改，只有阈值、严重度和启停可调；改动会写入审计日志。
        比率类规则带 <span class="mono">min_samples</span> 下限，样本不足时不下结论。</p>
      <div class="table-wrap"><table><thead><tr>
        <th>规则</th><th>指标</th><th>触发条件</th><th>阈值</th><th>严重度</th><th>启用</th><th>来源</th>
      </tr></thead><tbody>${ruleRows}</tbody></table></div>
      <p class="hint" style="margin-top:10px">改完立即生效并重新评估。</p>
    </div>`;

  $$('#page [data-ack]').forEach((b) => {
    b.onclick = async () => {
      await api(`/alerts/${encodeURIComponent(b.dataset.ack)}/ack`, { method: 'POST', body: { signature: b.dataset.sig } });
      toast('已确认，指标变化后会重新告警');
      router();
    };
  });
  $$('#page [data-unack]').forEach((b) => {
    b.onclick = async () => {
      await api(`/alerts/${encodeURIComponent(b.dataset.unack)}/ack`, { method: 'DELETE' });
      toast('已取消确认');
      router();
    };
  });
  $$('#page [data-rule]').forEach((el) => {
    el.onchange = async () => {
      const key = el.dataset.rule, field = el.dataset.field;
      let value;
      if (field === 'enabled') value = el.checked;
      else if (field === 'threshold') {
        value = Number(el.value);
        if (!isFinite(value)) { toast('阈值必须是数字'); return; }
      } else value = el.value;
      try {
        await api('/alerts/rules', { method: 'PUT', body: { rules: { [key]: { [field]: value } } } });
        toast('规则已更新：' + key + ' · ' + field);
        router();
      } catch (e) { toast('保存失败：' + e.message); }
    };
  });
}

/* ------------------------------------------------------------ 使用说明（中英双语） */

const DOC_LANG_KEY = 'harness_doc_lang';
let DOC_LANG = localStorage.getItem(DOC_LANG_KEY) === 'en' ? 'en' : 'zh';

/** 取值：字符串（中英共用，例如代码）或 {zh,en}；也可能取到数组。 */
function T(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || Array.isArray(v)) return v;
  if (v[DOC_LANG] !== undefined) return v[DOC_LANG];
  return v.zh !== undefined ? v.zh : (v.en || '');
}

function docCode(txt) {
  return esc(txt).split('\n').map((l) => (l.trimStart().startsWith('#') ? `<span class="c">${l}</span>` : l)).join('\n');
}

const DOC_UI = {
  zh: {
    lead: '这是一份可以边看边做的说明书。左边是目录，右上角可切换中英文。',
    toc: '目录', next: '下一节', prev: '上一节',
    switchTo: 'English', badge: '中文',
    foot: 'AgentLoop Harness · 说明书内容对应代码实现，如与界面不一致请以界面为准',
  },
  en: {
    lead: 'A hands-on manual you can follow while working. Table of contents on the left; switch language at the top right.',
    toc: 'Contents', next: 'Next', prev: 'Previous',
    switchTo: '中文', badge: 'EN',
    foot: 'AgentLoop Harness · This manual mirrors the implementation; when in doubt, trust the UI',
  },
};

const DOC_SECTIONS = [
  /* ---------------------------------------------------------- 1 快速开始 */
  {
    id: 'quickstart',
    title: { zh: '一、五分钟上手', en: '1. Five-minute quick start' },
    sub: { zh: '从零到看见第一个 BadCase', en: 'From zero to your first BadCase' },
    blocks: [
      { t: 'p', v: { zh: '这个产品的核心回路是四步：<b>录快照 → 标真值 → 跑回放 → 改 skill/prompt</b>。先用内置演示数据把这个回路走一遍，比读文档快得多。',
                      en: 'The core loop has four steps: <b>record a snapshot → annotate ground truth → replay → patch skill/prompt</b>. Walking the loop once with the built-in demo data beats reading docs.' } },
      { t: 'h3', v: { zh: '启动', en: 'Start it' } },
      { t: 'code', v: `# 首次运行会自动建 .venv 并装依赖，然后写入演示数据并启动
./run.sh --seed

# 浏览器打开 http://127.0.0.1:8848 ，演示账号 admin / admin123
# 只想验证打分逻辑、不启动服务：
./run.sh --selfcheck` },
      { t: 'h3', v: { zh: '走一遍完整回路', en: 'Walk the full loop' } },
      { t: 'ol', v: {
        zh: [
          '进「运行记录」，用状态筛选挑一条 <span class="mono">failed</span> 的运行，点进去看瀑布图与信号时间线。',
          '点右上角「沉淀为案例」——平台会从快照里自动抽出四层真值初稿，并立刻跑一次 GSTO 四层门禁。',
          '进「案例库」，打开刚建的案例，复核四个字段（故障类型 / 根因实体 / 因果链 / 证据检查点）后保存。',
          '点「离线回放」跑一次，看定因 / 定界 / 过程三个维度各拿多少分——首次回放会存为基线。',
          '回到「监控告警」，看这个 Agent 的健康快照与触发的规则。',
          '进「优化建议」，点「重新分析 BadCase」，读一遍生成的三类补丁（prompt / skill / 实体别名表）的 diff。',
        ],
        en: [
          'Open <b>Runs</b>, filter by status <span class="mono">failed</span>, and open one to inspect the waterfall chart and signal timeline.',
          'Click <b>Save as case</b> in the top right — the platform drafts the four-layer ground truth from the snapshot and runs the GSTO gate immediately.',
          'Open the new case in <b>Case Library</b>, review the four fields (fault type / root-cause entity / causal chain / evidence checkpoints), then save.',
          'Click <b>Offline replay</b> and read the three dimension scores — fault / entity / process. The first replay is stored as the baseline.',
          'Go to <b>Monitoring &amp; Alerts</b> to see this agent\'s health snapshot and the rules that fired.',
          'Go to <b>Optimization Suggestions</b>, click <b>Re-analyze BadCases</b>, and read the diffs of the three patch kinds (prompt / skill / entity alias map).',
        ],
      } },
      { t: 'note', kind: 'warn', h: { zh: '别跳过真值复核', en: 'Do not skip ground-truth review' },
        v: { zh: '自动抽取出来的只是<b>初稿</b>。真值一旦错了，后面所有打分、聚类和补丁都会跟着错——这是整个系统里最值得花时间的一步。',
             en: 'Auto-filled values are a <b>draft</b>. Wrong ground truth poisons every downstream score, cluster, and patch — this is the highest-leverage step in the system.' } },
    ],
  },

  /* ---------------------------------------------------------- 2 接入 */
  {
    id: 'connect',
    title: { zh: '二、Agent 如何接入', en: '2. Connect your agent' },
    sub: { zh: '四种方式，按你的改造成本选', en: 'Four options, pick by how much you can change your agent' },
    blocks: [
      { t: 'note', kind: 'ok', h: { zh: '先拿一个 Token', en: 'Get a token first' },
        v: { zh: '到「接入与设置」页生成 API Token（<span class="mono">hnx_</span> 前缀）。<b>只在生成时显示一次</b>，请立刻保存。SDK、CLI 和 HTTP 直传都用它。',
             en: 'Generate an API token (prefix <span class="mono">hnx_</span>) in <b>Integration &amp; Settings</b>. It is <b>shown only once</b> — save it immediately. The SDK, CLI, and raw HTTP all use it.' } },

      { t: 'h3', v: { zh: '方式一：Python SDK 包裹（推荐）', en: 'Option 1: Python SDK wrapper (recommended)' } },
      { t: 'p', v: { zh: 'SDK 零第三方依赖（纯标准库），可以直接塞进你现有的 Agent 代码里。',
                      en: 'The SDK has zero third-party dependencies (stdlib only) and drops straight into your existing agent code.' } },
      { t: 'code', v: `from harness import Harness

h = Harness(endpoint="http://127.0.0.1:8848", token="hnx_...",
            agent="ops-agent", agent_version="v1.4.2", env="prod")

# with 块退出时自动上报快照；auto_case=True 且调过 answer() 时顺带沉淀成案例
with h.run(task="下单接口 P99 飙升", auto_case=True) as rec:
    rec.alert("entry-api p99 > 3s (5m)", entity="frontend")           # 现场原始告警
    rec.metric("checkout-service", "p99", 3800, severity="critical")  # 指标
    rec.log("checkout-db", "slow query: SELECT ... took 2841ms", severity="error")
    rec.trace("gateway-5xx-ratio-up")                                 # 因果链的步骤
    rec.trace("checkout-latency-up")
    rec.event("K8s: no restarts observed, rule out pod lifecycle", entity="checkout-service")
    rec.topology("checkout-db -> ack-node-02 -> checkout-service -> frontend")

    with rec.span("query-metrics", kind="tool", entity="checkout-db"):   # 计耗时
        result = call_my_tool()                                        # 你的真实工具调用

    rec.usage(tokens_in=12000, tokens_out=5200, cost_usd=0.031)
    rec.answer(                                                        # 最终作答
        fault_type="slowSQL", entity="prod-checkout-db:3306",
        causal_chain=["gateway-5xx-ratio-up", "checkout-latency-up",
                      "db-query-time-up", "slow-sql-found"],
        evidence=[{"name": "checkout-db 慢查询语句", "value": "SELECT ... FROM orders"}],
    )` },
      { t: 'p', v: { zh: '记录原语——每个调用写进哪个模态：', en: 'Recording primitives — which modality each call writes to:' } },
      { t: 'table',
        head: [{ zh: '调用', en: 'Call' }, { zh: '模态', en: 'Modality' }, { zh: '说明', en: 'Notes' }],
        rows: [
          ['rec.metric(entity, name, value, severity)', 'metric', { zh: '数值型指标，告警与看板的主要来源', en: 'Numeric metric; the main source for alerts and dashboards' }],
          ['rec.log(entity, text, severity)', 'log', { zh: '日志行，单条会被截断到 4000 字符', en: 'A log line, truncated to 4000 chars per entry' }],
          ['rec.trace(step, entity)', 'trace', { zh: '因果链的步骤名，回放时按顺序比对', en: 'A causal-chain step name, order-compared during replay' }],
          ['rec.event(text, entity)', 'event', { zh: 'K8s 事件等离散事件', en: 'Discrete events such as Kubernetes events' }],
          ['rec.alert(text, entity, severity)', 'alert', { zh: '故障现场的原始告警文本（不是本平台产生的告警）', en: 'Raw alert text from the fault site (not an alert produced by this platform)' }],
          ['rec.topology(text, entity)', 'topology', { zh: '实体关系，用于补全拓扑', en: 'Entity relations, used to complete the topology' }],
          ['rec.span(name, kind="tool")', 'spans', { zh: '记录一段耗时；kind="tool" 时工具调用数 +1', en: 'Times a block; kind="tool" increments the tool-call count' }],
          ['rec.tool_call(name, ok=True)', 'spans', { zh: '只记一次工具调用，不记耗时', en: 'Records a tool call without timing it' }],
          ['rec.usage(tokens_in, tokens_out, cost_usd)', 'run', { zh: '累加到本次运行的成本字段', en: 'Accumulates into the run\'s cost fields' }],
          ['rec.answer(...)', 'snapshot', { zh: 'Agent 最终作答；离线回放直接用它，不重新调用 Agent', en: 'The agent\'s final answer; offline replay uses it without calling the agent again' }],
          ['rec.fail(type, msg) / rec.partial(...)', 'run', { zh: '把本次运行标记为失败 / 部分完成', en: 'Marks this run as failed / partial' }],
        ] },

      { t: 'h3', v: { zh: '方式二：命令行包裹式录制', en: 'Option 2: CLI process wrapper' } },
      { t: 'p', v: { zh: '完全不用改 Agent 代码，把任意命令包起来跑就行。子进程的 stdout/stderr 会逐行录成日志，退出码非 0 自动标记失败。',
                      en: 'No agent code changes at all — wrap any command. stdout/stderr are recorded line by line, and a non-zero exit code marks the run as failed.' } },
      { t: 'code', v: `cd sdk && pip install -e .          # 安装 CLI（入口命令 harness）

harness login --endpoint http://127.0.0.1:8848 --token hnx_...
harness status                                     # 自检连通性
harness record --task "数据库巡检" -- python check_db.py
harness record --task "日志抓取" -- bash collect.sh` },

      { t: 'h3', v: { zh: '方式三：导入已有日志目录（离线快照）', en: 'Option 3: import existing log directories' } },
      { t: 'p', v: { zh: '已经落盘的 trace/metrics/logs 文件不用重跑，按文件名决定模态直接导进来。',
                      en: 'Already-persisted trace/metrics/logs files can be imported without re-running anything; the filename decides the modality.' } },
      { t: 'code', v: `harness snapshot --dir ./snapshots --glob '*.jsonl' \\
  --task "checkout P99 飙升" --error-type slowSQL --run-id snap-001

# 文件名 → 模态的映射：
#   metrics.jsonl  → metric      logs.jsonl   → log
#   traces.jsonl   → trace       events.jsonl → event
#   alerts.jsonl   → alert       topology.jsonl → topology
# 每行一个 JSON 对象，宽松解析：解析不了的行会整体当成 text 收下，不会中断导入。` },
      { t: 'p', v: { zh: '每行支持的字段：<span class="mono">entity</span>、<span class="mono">entity_type</span>、<span class="mono">name</span>（或 <span class="mono">metric</span>）、<span class="mono">ts_ms</span>（或 <span class="mono">timestamp</span>）、<span class="mono">value</span>、<span class="mono">text</span>（或 <span class="mono">message</span> / <span class="mono">log</span>）、<span class="mono">severity</span>。',
                      en: 'Fields recognised per line: <span class="mono">entity</span>, <span class="mono">entity_type</span>, <span class="mono">name</span> (or <span class="mono">metric</span>), <span class="mono">ts_ms</span> (or <span class="mono">timestamp</span>), <span class="mono">value</span>, <span class="mono">text</span> (or <span class="mono">message</span> / <span class="mono">log</span>), <span class="mono">severity</span>.' } },

      { t: 'h3', v: { zh: '方式四：HTTP 直传（任何语言都能接）', en: 'Option 4: raw HTTP (works from any language)' } },
      { t: 'code', v: `POST /api/v1/ingest/run
X-Api-Token: hnx_...

{
  "run": {
    "external_run_id": "run-20260924-001",   // 必填
    "agent": "ops-agent", "task": "下单接口 P99 飙升",
    "status": "failed", "env": "prod", "model": "qwen-max",
    "started_at": "2026-09-24T14:02:00", "ended_at": "2026-09-24T14:06:00",
    "duration_ms": 240000, "tokens_in": 12000, "tokens_out": 5200,
    "cost_usd": 0.031, "tool_calls": 8, "steps": 6,
    "error_type": "slowSQL", "error_message": "checkout-db 慢查询"
  },
  "spans":   [{ "span_id": "s1", "name": "query-metrics", "kind": "tool",
                "start_ms": 1758700920000, "end_ms": 1758700920180, "status": "ok" }],
  "signals": [{ "modality": "metric", "entity_key": "prod-checkout-db:3306",
                "name": "p99", "value": 3800, "severity": "critical" }],
  "snapshot": { "collector": "my-agent", "window_minutes": 30 }
}

# 批量：POST /api/v1/ingest/batch   body = { "runs": [ ...上面的 bundle... ] }` },
      { t: 'note', kind: 'ok', h: { zh: '重复上报是幂等的', en: 'Re-ingesting is idempotent' },
        v: { zh: '同一个 <span class="mono">external_run_id</span> 再传一次会<b>覆盖</b>原有记录及其 spans/signals，方便补数据或修正字段，不会产生重复行。',
             en: 'Re-sending the same <span class="mono">external_run_id</span> <b>overwrites</b> the existing record along with its spans/signals — convenient for backfilling or corrections, and it never duplicates rows.' } },
      { t: 'note', kind: 'warn', h: { zh: '实体名会被自动归一化', en: 'Entity names are normalised automatically' },
        v: { zh: '<span class="mono">prod-cart-service-5f7c9d-x2k4</span>、<span class="mono">cart_service:8080</span>、<span class="mono">PROD/cart-service</span> 会统一收敛成 <span class="mono">cart-service</span>。所以你<b>不需要</b>在 SDK 里做名字清洗，原样上报即可。',
             en: '<span class="mono">prod-cart-service-5f7c9d-x2k4</span>, <span class="mono">cart_service:8080</span>, and <span class="mono">PROD/cart-service</span> all collapse to <span class="mono">cart-service</span>. You do <b>not</b> need to clean names in the SDK — report them verbatim.' } },
    ],
  },

  /* ---------------------------------------------------------- 3 测评 */
  {
    id: 'evaluate',
    title: { zh: '三、如何测评', en: '3. How evaluation works' },
    sub: { zh: '四层真值、GSTO 门禁、确定性打分、三种回放', en: 'Four-layer ground truth, the GSTO gate, deterministic scoring, three replay modes' },
    blocks: [
      { t: 'p', v: { zh: '测评的最小单位是 <b>Case</b>：一份故障现场快照 + 一套四层真值。Agent 的作答与真值比对后，得到综合分与判定。',
                      en: 'The unit of evaluation is a <b>Case</b>: one fault snapshot plus one four-layer ground truth. The agent\'s answer is compared against the truth to produce a composite score and a verdict.' } },

      { t: 'h3', v: { zh: '四层真值', en: 'The four layers of ground truth' } },
      { t: 'table',
        head: [{ zh: '层', en: 'Layer' }, { zh: '字段', en: 'Field' }, { zh: '怎么比', en: 'How it is compared' }, { zh: '权重', en: 'Weight' }],
        rows: [
          [{ zh: '定因', en: 'Fault' }, 'fault_type',
           { zh: '规范到故障词表后比对。完全一致 1.0；同组 0.6；相邻组 0.3；隔两组 0.12；未命中 0.05', en: 'Normalised against the fault taxonomy: exact 1.0, same group 0.6, adjacent group 0.3, two groups away 0.12, miss 0.05' },
           { zh: '40%', en: '40%' }],
          [{ zh: '定界', en: 'Entity' }, 'root_cause_entity / entity_key',
           { zh: '归一化后按实体拓扑距离算：0 跳 1.0，每多一跳 −0.25；拓扑不可达时退化为字符串相似度（上限 0.45）', en: 'Normalised, then scored by topology distance: 0 hops = 1.0, −0.25 per extra hop; falls back to string similarity (capped at 0.45) when unreachable' },
           { zh: '30%', en: '30%' }],
          [{ zh: '过程', en: 'Process' }, 'causal_chain',
           { zh: '因果链的最长公共子序列覆盖率；顺序被打乱再乘 0.7 惩罚', en: 'LCS coverage of the causal chain; order scrambling applies a 0.7 penalty' },
           { zh: '占过程分的 60%', en: '60% of the process score' }],
          [{ zh: '过程', en: 'Process' }, 'evidence',
           { zh: '证据检查点：关键词命中、或「实体 + 指标」同时命中、或检查点为空，三者任一即算命中', en: 'Evidence checkpoints: a keyword hit, or an entity+metric hit, or an empty checkpoint — any one counts as a hit' },
           { zh: '占过程分的 40%', en: '40% of the process score' }],
        ] },
      { t: 'code', v: `综合分 = 定因 × 40% + 定界 × 30% + 过程 × 30%
过程分 = 因果链 × 60% + 证据 × 40%

判定：  综合分 ≥ 0.75  → pass
        综合分 ≥ 0.50  → partial
        综合分 <  0.50  → fail` },
      { t: 'note', kind: 'ok', h: { zh: '为什么不用大模型当裁判', en: 'Why there is no LLM judge' },
        v: { zh: '打分<b>完全确定性、零模型调用</b>。同一份数据任何时候重跑结果都一样，因此可以放进 CI 当回归门禁，出了问题也能逐条审计到权重与命中规则。代价是表达灵活性有限——这是刻意的取舍，稳定性优先于创造性。',
             en: 'Scoring is <b>fully deterministic and makes zero model calls</b>. The same data always yields the same result, so it can gate CI and every point can be audited down to the weight and hit rule. The cost is limited expressiveness — a deliberate trade of creativity for stability.' } },

      { t: 'h3', v: { zh: 'GSTO 四层准入门禁', en: 'The GSTO admission gate' } },
      { t: 'p', v: { zh: '建案例时会立刻跑一遍门禁。四层全过，这个样本才有资格成为黄金案例。',
                      en: 'The gate runs the moment a case is created. Only samples passing all four layers qualify as golden cases.' } },
      { t: 'table',
        head: [{ zh: '层', en: 'Layer' }, { zh: '通过条件', en: 'Pass condition' }],
        rows: [
          ['Structure', { zh: '标题 + 规范化故障类型 + 归一化根因实体，三样齐备', en: 'Title, normalised fault type, and normalised root-cause entity all present' }],
          ['Signal', { zh: '至少包含 metric / log / trace 三种模态，且信号条数 ≥ 5', en: 'Contains at least the metric / log / trace modalities with ≥ 5 signals' }],
          ['TimeWindow', { zh: '有有效时间戳，且观测窗口 ≤ 6 小时', en: 'Has valid timestamps and an observation window ≤ 6 hours' }],
          ['Openness', { zh: '根因实体已登记在实体模型中，可跨域映射、可算拓扑距离', en: 'Root-cause entity is registered in the entity model, so topology distance is computable cross-domain' }],
        ] },

      { t: 'h3', v: { zh: '三种回放模式', en: 'Three replay modes' } },
      { t: 'table',
        head: [{ zh: '模式', en: 'Mode' }, { zh: '行为', en: 'Behaviour' }, { zh: '用途', en: 'Use it for' }],
        rows: [
          ['offline', { zh: '用录制时的作答直接打分，<b>不</b>调用被测 Agent', en: 'Scores the recorded answer directly and does <b>not</b> call the agent' }, { zh: 'CI 回归，完全可复现', en: 'CI regression, fully reproducible' }],
          ['live', { zh: '把回放输入发给被测 Agent 端点（在设置页配置），用新作答打分', en: 'Sends the replay input to the configured agent endpoint and scores the fresh answer' }, { zh: '验证新版本是否真的变好', en: 'Verify a new version genuinely improved' }],
          ['snapshot', { zh: '只回放快照输入，不打分', en: 'Replays the snapshot input only, no scoring' }, { zh: '给人复盘现场', en: 'Human review of the scene' }],
        ] },
      { t: 'note', h: { zh: '回放输入里没有真值', en: 'Replay input contains no ground truth' },
        v: { zh: '送给被测 Agent 的只有快照信号，真值不参与——否则等于泄题。这一点在实现上是硬约束，不是配置项。',
             en: 'Only snapshot signals are sent to the agent; ground truth is withheld — otherwise it would be leaking the answer key. This is a hard constraint in the implementation, not a setting.' } },
      { t: 'h3', v: { zh: '案例状态自动流转', en: 'Automatic case status transitions' } },
      { t: 'table',
        head: [{ zh: '状态', en: 'Status' }, { zh: '含义', en: 'Meaning' }],
        rows: [
          ['golden', { zh: '门禁通过<b>且</b>回放判定 pass——可当回归基线', en: 'Gate passed <b>and</b> replay verdict is pass — usable as a regression baseline' }],
          ['badcase', { zh: '回放判定 fail——能力缺口的证据', en: 'Replay verdict is fail — evidence of a capability gap' }],
          ['candidate', { zh: '介于两者之间，等人工裁决', en: 'In between; awaiting human triage' }],
          ['draft', { zh: '刚建好、还没跑过回放', en: 'Just created, never replayed' }],
        ] },
      { t: 'p', v: { zh: '每次回放都会把上一次的成绩当基线，给出 <b>delta</b>；一旦某条黄金案例掉分，就是能力退化信号。批量回归请在「回放评测」页点「批量回放（黄金案例）」。',
                      en: 'Every replay treats the previous score as the baseline and reports a <b>delta</b>; a golden case losing points is a regression signal. For a full regression run, use <b>Batch replay (golden cases)</b> on the Replay page.' } },
    ],
  },

  /* ---------------------------------------------------------- 4 看数据 */
  {
    id: 'data',
    title: { zh: '四、如何查看测评数据', en: '4. Reading the evaluation data' },
    sub: { zh: '每个页面回答什么问题', en: 'What each page answers' },
    blocks: [
      { t: 'table',
        head: [{ zh: '页面', en: 'Page' }, { zh: '回答的问题', en: 'Question it answers' }],
        rows: [
          [{ zh: '总览大盘', en: 'Dashboard' }, { zh: '整体在变好还是变坏？成功率、成本、耗时的 14 天趋势，以及失分维度雷达', en: 'Is the whole thing getting better or worse? 14-day trends for success rate, cost and latency, plus a radar of weak dimensions' }],
          [{ zh: '运行记录', en: 'Runs' }, { zh: '具体哪一次跑砸了？可按状态 / Agent / 关键词筛选；点进去看瀑布图（各 span 耗时）、信号时间线与模态分布', en: 'Which exact run failed? Filter by status / agent / keyword, then open one to see its waterfall (per-span timing), signal timeline and modality breakdown' }],
          [{ zh: '案例库', en: 'Case Library' }, { zh: '我们一共有多少条可信的评测资产？黄金案例和 BadCase 各多少？支持批量回放黄金案例', en: 'How much trustworthy evaluation asset do we have? How many golden cases vs BadCases? Supports batch replay of golden cases' }],
          [{ zh: '案例详情', en: 'Case detail' }, { zh: '这一条的真值是什么、被打了几分、为什么是这个分（逐维度明细）', en: 'What is the ground truth for this case, what did it score, and why — per-dimension breakdown' }],
          [{ zh: '回放评测', en: 'Replay' }, { zh: '当前版本在既有案例集上表现如何？通过率、均分、与基线的 delta', en: 'How does the current version perform on the existing case set? Pass rate, mean score, delta vs baseline' }],
          [{ zh: '监控告警', en: 'Monitoring &amp; Alerts' }, { zh: '被测 Agent 本身健不健康？见下一节', en: 'Is the agent itself healthy? See the next section' }],
          [{ zh: '实体语义', en: 'Entity Semantics' }, { zh: '跨域实体名归一化到哪些统一主键？拓扑长什么样？归一化不生效时来这里补别名', en: 'Which unified keys do cross-domain entity names normalise to? What does the topology look like? Add aliases here when normalisation misses' }],
          [{ zh: '优化建议', en: 'Optimization' }, { zh: '下一步该改什么？见第六节', en: 'What should I change next? See section 6' }],
          [{ zh: '接入与设置', en: 'Integration &amp; Settings' }, { zh: 'Token、被测 Agent 端点、GitHub 仓库配置、操作审计', en: 'Tokens, the agent endpoint, GitHub repo config, and the audit log' }],
        ] },
      { t: 'h3', v: { zh: '把案例导出到你的 CI 仓库', en: 'Export cases into your CI repo' } },
      { t: 'code', v: `GET /api/v1/cases/{case_id}/export      # 或点案例详情页的「导出」

# 返回 schema 标记为 agentloop-harness/case@1 的自包含 JSON，
# 可直接落进被测 Agent 的仓库，在 CI 里做离线回归——不需要连平台数据库。` },
      { t: 'h3', v: { zh: '审计：每一次真值改动都有记录', en: 'Audit: every ground-truth change is recorded' } },
      { t: 'p', v: { zh: '「接入与设置」页底部是操作审计流水：谁改了四层真值、谁确认了优化建议、谁把它提交到了 GitHub。评测系统本身也需要可追溯。',
                      en: 'The bottom of <b>Integration &amp; Settings</b> is an append-only audit trail: who edited ground truth, who approved an optimization, who submitted it to GitHub. An evaluation system itself needs to be traceable.' } },
    ],
  },

  /* ---------------------------------------------------------- 5 监控告警 */
  {
    id: 'monitor',
    title: { zh: '五、如何监控 Agent 状态与告警', en: '5. Monitoring agent health and alerts' },
    sub: { zh: '10 条内置规则 + 可按时间窗评估', en: '10 built-in rules, evaluated over a selectable window' },
    blocks: [
      { t: 'p', v: { zh: '先厘清一件事：<b>监控</b>和<b>测评</b>回答的是两个不同问题。测评问「它答得对不对」（对着真值比）；监控问「它最近健不健康」（对着它自己的运行历史比）。两者互补，别混用。',
                      en: 'One distinction first: <b>monitoring</b> and <b>evaluation</b> answer different questions. Evaluation asks "is it correct?" (against ground truth); monitoring asks "is it healthy lately?" (against its own run history). They complement each other — do not conflate them.' } },
      { t: 'h3', v: { zh: '时间窗', en: 'Time window' } },
      { t: 'p', v: { zh: '页面右上角可切 <b>1 小时 / 24 小时 / 7 天</b>。窗口越短越灵敏（适合发布后盯盘），越长越稳（适合周度盘点）。',
                      en: 'Switch between <b>1 hour / 24 hours / 7 days</b> at the top right. Shorter windows are sensitive (good right after a release); longer windows are stable (good for weekly review).' } },
      { t: 'h3', v: { zh: 'Agent 健康快照', en: 'Agent health snapshot' } },
      { t: 'p', v: { zh: '每个已登记的 Agent 一行：窗口内运行数 / 累计运行数、成功率、平均耗时、最大工具调用、成本、最后上报时间。状态判定：',
                      en: 'One row per registered agent: runs in window / total runs, success rate, average duration, max tool calls, cost, last-seen time. Status rule:' } },
      { t: 'ul', v: {
        zh: ['<span class="chip ok">健康</span> 窗口内有上报，且成功率 ≥ 60%',
             '<span class="chip warn">退化</span> 窗口内有上报，但成功率低于 60%',
             '<span class="chip err">静默</span> 窗口内一条运行都没有——通常意味着接入断了或任务停了，而不是 Agent 变好了'],
        en: ['<span class="chip ok">healthy</span> reported in window, success rate ≥ 60%',
             '<span class="chip warn">degraded</span> reported in window, success rate below 60%',
             '<span class="chip err">silent</span> no runs at all in the window — usually a broken integration or a stopped job, not a healthy agent'],
      } },
      { t: 'h3', v: { zh: '内置 10 条规则', en: 'The 10 built-in rules' } },
      { t: 'table',
        head: [{ zh: '规则', en: 'Rule' }, { zh: '指标', en: 'Metric' }, { zh: '触发条件', en: 'Fires when' }, { zh: '默认阈值', en: 'Default' }, { zh: '严重度', en: 'Severity' }],
        rows: [
          ['success_rate_drop', 'success_rate', { zh: '低于', en: 'below' }, '60%', 'critical'],
          ['error_spike', 'error_rate', { zh: '高于', en: 'above' }, '30%', 'critical'],
          ['replay_pass_drop', 'replay_pass_rate', { zh: '低于', en: 'below' }, '60%', 'critical'],
          ['latency_spike', 'p95_duration_ms', { zh: '高于', en: 'above' }, '600s', 'warning'],
          ['tool_call_runaway', 'max_tool_calls', { zh: '不低于', en: 'at or above' }, '20', 'warning'],
          ['token_runaway', 'max_tokens_out', { zh: '不低于', en: 'at or above' }, '100,000', 'warning'],
          ['cost_budget', 'cost_usd', { zh: '高于', en: 'above' }, '$5.00', 'warning'],
          ['new_badcase', 'new_badcase', { zh: '不低于', en: 'at or above' }, '1', 'warning'],
          ['agent_silent', 'silent_agents', { zh: '不低于', en: 'at or above' }, '1', 'info'],
          ['no_data', 'runs', { zh: '低于', en: 'below' }, '1', 'info'],
        ] },
      { t: 'p', v: { zh: '每条告警都带 <b>refs</b>——指向具体的运行记录或具体案例，可以直接点进去，而不是只丢给你一个数字。',
                      en: 'Every alert carries <b>refs</b> pointing at concrete runs or cases, so you can click through instead of being handed a bare number.' } },

      { t: 'h3', v: { zh: '三条防噪设计', en: 'Three noise-control designs' } },
      { t: 'ul', v: {
        zh: ['<b>样本下限</b>：成功率 / 报错率至少要有 3 次运行、回放通过率至少要有 2 次回放才下结论。样本不足的规则会出现在「因样本不足跳过」里，让你知道它是被跳过了而不是通过了。',
             '<b>可调阈值</b>：阈值、严重度、启停都能在页面上直接改，改动写入审计日志。规则语义不可改，避免出现无法解释的状态。',
             '<b>确认按指标快照</b>：确认一条告警时记录的是「规则 + 量化后的指标值」（如 <span class="mono">success_rate=0.51</span>）。指标没变就不再提醒你，<b>指标真的变了会自动重新告警</b>——不会因为点过一次确认就把问题永久静音。'],
        en: ['<b>Minimum samples</b>: rate rules wait for at least 3 runs (or 2 replays) before drawing a conclusion. Skipped rules show up under "skipped for insufficient samples", so you know they were skipped rather than passed.',
             '<b>Tunable thresholds</b>: threshold, severity and enable/disable are editable on the page, and every change is written to the audit log. Rule semantics are immutable to prevent unexplainable states.',
             '<b>Snapshot-based acknowledgement</b>: acknowledging records "rule + quantised metric value" (e.g. <span class="mono">success_rate=0.51</span>). While the metric holds, you are not nagged; once it genuinely changes, the alert re-fires — so one click never mutes a problem forever.'],
      } },
      { t: 'note', kind: 'warn', h: { zh: '一个已知的取舍', en: 'A known trade-off' },
        v: { zh: '本平台的告警只在<b>你打开页面或调用接口时</b>计算，没有后台常驻的定时推送，也暂不支持邮件 / 企微通知。想接 CI 或巡检脚本，直接定时拉 <span class="mono">GET /api/v1/alerts?window_hours=24</span>，按 <span class="mono">summary.open</span> 判断是否要拦。',
             en: 'Alerts are computed <b>when you open the page or call the API</b> — there is no always-on scheduler and no email / IM delivery yet. To wire it into CI or a cron check, poll <span class="mono">GET /api/v1/alerts?window_hours=24</span> and gate on <span class="mono">summary.open</span>.' } },
      { t: 'code', v: `# CI 门禁示例：有未确认的严重告警就失败
curl -s "$HARNESS/alerts?window_hours=24" -H "X-Api-Token: $TOKEN" \\
  | jq -e '.summary.critical == 0' > /dev/null || exit 1

# 规则接口
GET    /api/v1/alerts?window_hours=24      # 评估
GET    /api/v1/alerts/rules                # 看有效规则
PUT    /api/v1/alerts/rules                # 改阈值：{"rules":{"cost_budget":{"threshold":20}}}
POST   /api/v1/alerts/{rule_key}/ack       # 确认：{"signature":"cost_usd=20.67"}
DELETE /api/v1/alerts/{rule_key}/ack       # 取消确认（该规则全部）` },
    ],
  },

  /* ---------------------------------------------------------- 6 优化 */
  {
    id: 'optimize',
    title: { zh: '六、如何根据测评数据优化', en: '6. Optimizing from evaluation data' },
    sub: { zh: '从 BadCase 到可评审的补丁，再到 GitHub PR', en: 'From BadCase to a reviewable patch to a GitHub PR' },
    blocks: [
      { t: 'p', v: { zh: '这一步是闭环的关键：把「答错了」变成「改哪一行」。流程是确定性的——BadCase 先聚类，再由规则引擎产出补丁，最后人工确认后提交。',
                      en: 'This step closes the loop: turning "it got it wrong" into "change this line". The pipeline is deterministic — BadCases are clustered, a rule engine emits patches, and a human approves before anything ships.' } },
      { t: 'code', v: `BadCase 池
   ↓  聚类：signature = fault_group::weak_dimension::entity_key
失分簇（同一类故障 + 同一个弱维度 + 同一个实体）
   ↓  规则引擎（4 条确定性规则）
带 unified diff 的补丁
   ↓  人工评审：看 diff、可改内容、点确认
approved
   ↓  提交：建分支 + 提交文件 + 开 PR
GitHub Pull Request（平台不自动合并）` },
      { t: 'h3', v: { zh: '四条规则分别改什么', en: 'What each of the four rules patches' } },
      { t: 'table',
        head: [{ zh: '触发条件', en: 'Fires when' }, { zh: '产出文件', en: 'Target file' }, { zh: '补什么', en: 'What it adds' }],
        rows: [
          [{ zh: '定因维度失分', en: 'Fault dimension is weak' }, 'prompts/&lt;agent&gt;.md',
           { zh: '注入故障类型判定表，让 Agent 先按表定位再下结论', en: 'Injects a fault-type decision table so the agent classifies before concluding' }],
          [{ zh: '定界维度失分', en: 'Entity dimension is weak' }, 'skills/&lt;agent&gt;/entity-aliases.yaml',
           { zh: '生成实体别名映射，把现场叫法接到统一主键', en: 'Generates an entity alias map wiring site-specific names to unified keys' }],
          [{ zh: '过程维度失分', en: 'Process dimension is weak' }, 'skills/&lt;agent&gt;/SKILL.md',
           { zh: '追加「诊断流程」章节：因果链要求 + 证据检查点 + 结论 JSON 契约', en: 'Appends a diagnostics-procedure chapter: causal-chain requirements, evidence checkpoints, and a conclusion JSON contract' }],
          [{ zh: '≥3 次运行工具调用 ≥15，或输出 token ≥120k', en: '≥3 runs with ≥15 tool calls or ≥120k output tokens' }, 'prompts/&lt;agent&gt;.md',
           { zh: '防打转与上下文裁剪约束，压成本', en: 'Loop-breaker and context-trimming constraints to cut cost' }],
        ] },
      { t: 'h3', v: { zh: '提交到 GitHub 的完整步骤', en: 'Submitting to GitHub, step by step' } },
      { t: 'ol', v: {
        zh: ['在「接入与设置」页填 GitHub Token、owner、repo、目标分支，然后点 <b>校验连通</b>。这一步必须过，否则后面提交会失败。',
             '回「优化建议」页，点「重新分析 BadCase」刷新补丁。',
             '逐条读 diff。<b>同一个目标 + 同一类建议不会重复堆积</b>（按 <span class="mono">path::category::case_ids</span> 去重）。内容不满意可以直接改。',
             '点「确认」——状态从 <span class="mono">draft</span> 变成 <span class="mono">approved</span>。',
             '点「提交到 GitHub」。平台会：建分支 <span class="mono">harness/opt-&lt;id&gt;-&lt;时间戳&gt;</span> → 提交目标文件 → 追加优化说明与案例快照 → 开 PR。',
             '到你自己的仓库 review 这个 PR。平台<b>不会</b>自动 push 到主干，也<b>不会</b>自动合并。'],
        en: ['In <b>Integration &amp; Settings</b>, fill in the GitHub token, owner, repo and base branch, then click <b>Verify connection</b>. This must pass or submissions will fail.',
             'Back on <b>Optimization Suggestions</b>, click <b>Re-analyze BadCases</b> to refresh the patches.',
             'Read each diff. <b>Same target plus same suggestion kind never piles up</b> (deduped by <span class="mono">path::category::case_ids</span>). You can edit the content if you disagree.',
             'Click <b>Approve</b> — the status moves from <span class="mono">draft</span> to <span class="mono">approved</span>.',
             'Click <b>Submit to GitHub</b>. The platform creates branch <span class="mono">harness/opt-&lt;id&gt;-&lt;timestamp&gt;</span>, commits the target file, appends the rationale plus the case snapshot, and opens a PR.',
             'Review the PR in your own repo. The platform <b>never</b> pushes to the trunk and <b>never</b> merges automatically.'],
      } },
      { t: 'note', kind: 'danger', h: { zh: '提交前请确认 Token 权限范围', en: 'Check your token scope before submitting' },
        v: { zh: '平台需要 Token 具备该仓库的写权限（<span class="mono">Contents: Read and write</span> 与 <span class="mono">Pull requests: Read and write</span>）。建议用细粒度 Token 并只授权目标仓库，不要用全权限的经典 Token。',
             en: 'The token needs write access to the repo (<span class="mono">Contents: Read and write</span> and <span class="mono">Pull requests: Read and write</span>). Prefer a fine-grained token scoped to just that repo over a broad classic token.' } },
      { t: 'note', kind: 'ok', h: { zh: '提交包含什么', en: 'What a submission contains' },
        v: { zh: '三个文件：① 目标文件本身（如 <span class="mono">prompts/ops-agent.md</span>）；② <span class="mono">harness/optimizations/&lt;slug&gt;.md</span> 优化说明（含关联案例与打分依据）；③ <span class="mono">harness/cases/&lt;case_key&gt;.json</span> 案例快照。这样 PR 本身就是一份可追溯的评测档案。',
             en: 'Three files: (1) the target file itself (e.g. <span class="mono">prompts/ops-agent.md</span>); (2) <span class="mono">harness/optimizations/&lt;slug&gt;.md</span> with the rationale, linked cases and scoring evidence; (3) <span class="mono">harness/cases/&lt;case_key&gt;.json</span> as the case snapshot. The PR thus doubles as a traceable evaluation record.' } },
      { t: 'h3', v: { zh: '改完之后要验证', en: 'Verify after you change something' } },
      { t: 'p', v: { zh: '补丁合入后，回到「回放评测」跑一次黄金案例全量套件。通过率应当上升、而且<b>不应该有原本通过的黄金案例掉下来</b>——后者比前者更重要。',
                      en: 'Once the patch lands, run the full golden-case suite on the <b>Replay</b> page. The pass rate should go up, and — more importantly — no previously passing golden case should drop.' } },
      { t: 'code', v: `# 命令行也可以跑整套回归
harness replay --suite golden --mode offline
harness analyze --verbose
harness submit --id 7` },
    ],
  },

  /* ---------------------------------------------------------- 7 术语 */
  {
    id: 'glossary',
    title: { zh: '七、概念速查', en: '7. Glossary' },
    sub: { zh: '界面上会遇到的词', en: 'Terms you will meet in the UI' },
    blocks: [
      { t: 'table',
        head: [{ zh: '词', en: 'Term' }, { zh: '含义', en: 'Meaning' }],
        rows: [
          [{ zh: '快照', en: 'Snapshot' }, { zh: '一次运行的全部现场材料：run 元数据 + spans + 各模态 signals', en: 'All material from one run: run metadata, spans, and signals across modalities' }],
          [{ zh: '模态 / modality', en: 'Modality' }, { zh: '信号类型：metric / log / trace / event / alert / topology', en: 'Signal kinds: metric / log / trace / event / alert / topology' }],
          [{ zh: '四层真值', en: 'Four-layer ground truth' }, { zh: '定因 + 定界 + 过程（因果链、证据）——评测的标准答案', en: 'Fault + entity + process (causal chain, evidence) — the answer key for evaluation' }],
          [{ zh: '归一化实体', en: 'Normalised entity' }, { zh: '跨域实体名收敛后的统一主键，如 <span class="mono">cart-service</span>；定界打分与拓扑都基于它', en: 'The unified key a cross-domain entity name collapses to, e.g. <span class="mono">cart-service</span>; both entity scoring and topology rely on it' }],
          [{ zh: 'GSTO 门禁', en: 'GSTO gate' }, { zh: '样本准入检查：Structure / Signal / TimeWindow / Openness', en: 'Sample admission check: Structure / Signal / TimeWindow / Openness' }],
          [{ zh: '黄金案例', en: 'Golden case' }, { zh: '门禁通过且回放 pass，可当回归基线的样本', en: 'Gate passed and replay passed — usable as a regression baseline' }],
          [{ zh: 'BadCase', en: 'BadCase' }, { zh: '回放 fail 的样本，是能力缺口的证据，也是优化器的输入', en: 'A sample that failed replay — evidence of a capability gap and the optimizer\'s input' }],
          [{ zh: '弱维度', en: 'Weak dimension' }, { zh: '该案例失分最多的那个维度（定因 / 定界 / 过程），聚类的一部分', en: 'The dimension where a case lost the most (fault / entity / process); part of the cluster key' }],
          [{ zh: '基线 / delta', en: 'Baseline / delta' }, { zh: '该案例上一次回放的分数；本次与它的差就是 delta', en: 'The case\'s previous replay score; the difference from it is the delta' }],
          [{ zh: '确定性打分', en: 'Deterministic scoring' }, { zh: '零模型调用，同输入必得同分数，可复现可审计', en: 'Zero model calls; identical input always yields an identical score — reproducible and auditable' }],
          [{ zh: '告警签名', en: 'Alert signature' }, { zh: '「规则 + 量化后的指标值」，确认状态的锚点；变了就重新告警', en: '"Rule + quantised metric value" — the anchor for acknowledgement; a change re-fires the alert' }],
        ] },
    ],
  },

  /* ---------------------------------------------------------- 8 FAQ */
  {
    id: 'faq',
    title: { zh: '八、常见问题', en: '8. FAQ' },
    sub: { zh: '部署与使用中的真实疑问', en: 'Real questions from deployment and daily use' },
    blocks: [
      { t: 'h3', v: { zh: '数据存在哪里？会不会丢？', en: 'Where is data stored? Can it be lost?' } },
      { t: 'p', v: { zh: '单文件 SQLite，默认 <span class="mono">data/harness.db</span>，可用环境变量 <span class="mono">HARNESS_DB</span> 改。开的是 WAL 模式。备份就是复制这个文件——但<b>要先停服务</b>，否则可能拿到半个 WAL。',
                      en: 'A single SQLite file, default <span class="mono">data/harness.db</span>, overridable via <span class="mono">HARNESS_DB</span>. WAL mode is on. Backing up means copying that file — but <b>stop the service first</b>, or you may capture a partial WAL.' } },
      { t: 'h3', v: { zh: '我的 Agent 不是运维场景，能用吗？', en: 'My agent is not an ops agent. Does this apply?' } },
      { t: 'p', v: { zh: '能。四层真值本质是一套通用的「定位类任务」评测范式——任何「找出问题出在哪、依据是什么」的 Agent 都适用。需要换的是两样东西：故障词表，以及实体模型（在「实体语义」页登记你自己的实体与别名）。',
                      en: 'Yes. The four layers are really a general paradigm for localisation tasks — any agent that must "find where the problem is and on what evidence" fits. Two things need swapping: the fault taxonomy and the entity model (register your own entities and aliases on the Entity Semantics page).' } },
      { t: 'h3', v: { zh: '为什么我的案例建完就是 candidate，不是 golden？', en: 'Why is my case stuck at candidate instead of golden?' } },
      { t: 'p', v: { zh: 'golden 要求<b>门禁通过</b>和<b>回放 pass</b>两个条件同时成立，缺一不可。先到「案例详情」看 GSTO 四层是哪层没过——最常见的是 Signal 层（信号不足 5 条，或缺 metric/log/trace 中的某一种）和 Openness 层（根因实体没登记）。',
                      en: 'Golden requires <b>both</b> a passed gate and a passing replay. Open the case detail to see which GSTO layer failed — most often Signal (fewer than 5 signals, or a missing metric/log/trace modality) or Openness (root-cause entity not registered).' } },
      { t: 'h3', v: { zh: 'live 回放一直失败？', en: 'Live replay keeps failing?' } },
      { t: 'p', v: { zh: '先确认「接入与设置」里的被测 Agent 端点填对了、且从本机能访问。如果你的机器配了 HTTP 代理，注意实现里对<b>回环地址已做绕过代理</b>（避免本地 Agent 被代理拦掉），远端端点则保留代理能力——所以本地端点请写 <span class="mono">127.0.0.1</span> 而不是主机名。',
                      en: 'First check that the agent endpoint in <b>Integration &amp; Settings</b> is correct and reachable from this machine. If your machine uses an HTTP proxy, note that <b>loopback addresses bypass the proxy</b> (so a local agent is not intercepted) while remote endpoints keep proxy support — so write <span class="mono">127.0.0.1</span>, not a hostname, for a local agent.' } },
      { t: 'h3', v: { zh: '上生产前必须改什么？', en: 'What must change before production?' } },
      { t: 'ul', v: {
        zh: ['<span class="mono">HARNESS_SECRET</span>：会话签名密钥，默认值是开发用的，<b>必须换掉</b>，否则会话可被伪造。',
             '<b>管理员密码</b>：演示数据里的 <span class="mono">admin / admin123</span> 是公开的默认值，公网可达时必须改。',
             '<b>HTTPS</b>：会话 Token 与 API Token 都走请求头明文传输，一定要在前面挂 TLS 终止。',
             '<b>数据库备份</b>：SQLite 单文件，建议定时停服备份或改用 WAL 快照方式。'],
        en: ['<span class="mono">HARNESS_SECRET</span>: the session signing key. The default is for development and <b>must</b> be replaced, or sessions can be forged.',
             '<b>Admin password</b>: the demo <span class="mono">admin / admin123</span> is a public default and must be changed whenever the instance is reachable.',
             '<b>HTTPS</b>: both session and API tokens travel in plaintext headers, so terminate TLS in front of it.',
             '<b>Backups</b>: single-file SQLite — schedule backups with the service stopped, or use a WAL-aware snapshot.'],
      } },
      { t: 'h3', v: { zh: '想扩展故障词表 / 加新的打分维度？', en: 'Want to extend the fault taxonomy or add a scoring dimension?' } },
      { t: 'p', v: { zh: '词表与权重都在 <span class="mono">backend/app/scoring.py</span> 里，改完跑 <span class="mono">./run.sh --selfcheck</span> 就能验证没有回归（35 条断言覆盖归一化、打分、门禁、导入、回放、优化器）。权重一改，历史分数不会自动重算——需要重跑回放。',
                      en: 'The taxonomy and weights live in <span class="mono">backend/app/scoring.py</span>; after editing, run <span class="mono">./run.sh --selfcheck</span> to confirm no regression (35 assertions covering normalisation, scoring, the gate, ingest, replay, and the optimizer). Note that changing weights does not retroactively recompute historical scores — re-run the replays.' } },
    ],
  },
];

async function pageDocs() {
  const ui = DOC_UI[DOC_LANG];
  const toc = DOC_SECTIONS.map((s, i) =>
    `<a href="#${s.id}" data-toc="${s.id}">${esc(T(s.title))}</a>`).join('');

  const renderBlocks = (blocks) => blocks.map((b) => {
    if (b.t === 'p') return `<p>${T(b.v)}</p>`;
    if (b.t === 'h3') return `<h3>${esc(T(b.v))}</h3>`;
    if (b.t === 'code') return `<div class="doc-code">${docCode(T(b.v))}</div>`;
    if (b.t === 'ul') return `<ul>${T(b.v).map((x) => `<li>${x}</li>`).join('')}</ul>`;
    if (b.t === 'ol') return `<ol>${T(b.v).map((x) => `<li>${x}</li>`).join('')}</ol>`;
    if (b.t === 'note') {
      const h = T(b.h);
      return `<div class="doc-note ${b.kind || ''}">${h ? `<span class="n-h">${esc(h)}</span>` : ''}${T(b.v)}</div>`;
    }
    if (b.t === 'table') {
      const head = T(b.head), rows = T(b.rows);
      // 单元格内容由本文件静态撰写，允许内联标记（<b>、<span class="mono">），
      // 需要字面量尖括号的地方一律写实体（&lt; &gt;）。
      return `<div class="table-wrap"><table class="doc-table"><thead><tr>${
        head.map((h) => `<th>${T(h)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${r.map((c) => `<td>${T(c)}</td>`).join('')}</tr>`).join('')
      }</tbody></table></div>`;
    }
    return '';
  }).join('');

  const sections = DOC_SECTIONS.map((s, i) => {
    const prev = DOC_SECTIONS[i - 1], next = DOC_SECTIONS[i + 1];
    const nav = `<div class="doc-anchor-nav">
      <span>${prev ? `<a href="#${prev.id}" data-toc="${prev.id}">← ${esc(T(prev.title))}</a>` : ''}</span>
      <span>${next ? `<a href="#${next.id}" data-toc="${next.id}">${esc(T(next.title))} →</a>` : ''}</span>
    </div>`;
    return `<section class="doc-sec" id="${s.id}">
      <h2>${esc(T(s.title))}</h2>
      <div class="sec-sub">${esc(T(s.sub))}</div>
      ${renderBlocks(s.blocks)}
      ${nav}
    </section>`;
  }).join('');

  $('#page-actions').innerHTML =
    `<div class="lang-switch">
       <button class="${DOC_LANG === 'zh' ? 'active' : ''}" data-lang="zh">中文</button>
       <button class="${DOC_LANG === 'en' ? 'active' : ''}" data-lang="en">English</button>
     </div>`;

  $('#page').innerHTML = `
    <div class="doc-toolbar">
      <div class="doc-lead" style="margin:0">${esc(ui.lead)}</div>
      <div class="hint">${DOC_LANG === 'zh' ? '中文 / English' : 'Chinese / English'}</div>
    </div>
    <div class="doc-layout">
      <aside class="doc-toc">
        <div class="toc-h">${esc(ui.toc)}</div>
        ${toc}
      </aside>
      <div>${sections}<div class="doc-foot">${esc(ui.foot)}</div></div>
    </div>`;

  const jump = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $$('#page [data-toc]').forEach((a) => a.classList.toggle('active', a.dataset.toc === id));
  };
  $$('#page [data-toc]').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); jump(a.dataset.toc); };
  });
  $$('#page-actions [data-lang]').forEach((b) => {
    b.onclick = () => {
      if (DOC_LANG === b.dataset.lang) return;
      DOC_LANG = b.dataset.lang;
      localStorage.setItem(DOC_LANG_KEY, DOC_LANG);
      pageDocs();
    };
  });
}

/* ------------------------------------------------------------ 启动 */

async function boot() {
  if (!TOKEN) { $('#login-view').classList.remove('hidden'); return; }
  try {
    ME = await api('/auth/me');
  } catch (e) {
    logout();
    return;
  }
  $('#login-view').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  $('#user-chip').textContent = (ME.display_name || ME.username) + ' · 已登录';
  if (!location.hash) location.hash = '#/dashboard';
  await router();
  try {
    const ov = await api('/stats/overview');
    const b = $('#nav-opt-badge');
    if (ov.optimizations_pending) { b.textContent = ov.optimizations_pending; b.classList.remove('hidden'); }
  } catch (e) { /* ignore */ }
  try {
    const ev = await api('/alerts?window_hours=24');
    const ab = $('#nav-alert-badge');
    const open = ev.summary.open || 0;
    if (open) {
      ab.textContent = open;
      ab.classList.toggle('a', !ev.summary.critical);
      ab.classList.remove('hidden');
    }
  } catch (e) { /* ignore */ }
}

boot();
