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
  optimize: { title: '优化建议', render: pageOptimize },
  entities: { title: '实体语义', render: pageEntities },
  settings: { title: '接入与设置', render: pageSettings },
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

/* ------------------------------------------------------------------ 启动 */

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
}

boot();
