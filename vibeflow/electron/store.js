const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const STAGES = require('../shared/stages.json');

const uid = (p = 'id') => `${p}_${crypto.randomUUID().slice(0, 8)}`;
const now = () => Date.now();

function computeProgress(goal) {
  const baseline = STAGES.baseline[goal.stage] || 0;
  const tasks = goal.tasks || [];
  let contrib = 0;
  if (tasks.length) {
    const done = tasks.filter((t) => t.done).length;
    contrib = Math.round((done / tasks.length) * 22);
  }
  return Math.min(100, baseline + contrib);
}

class Store {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.state = null;
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.dataPath), { recursive: true });
    fs.writeFileSync(this.dataPath, JSON.stringify(this.state, null, 2));
  }

  getState() {
    return this.state;
  }

  setSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    return this.state;
  }

  _findGoal(id) {
    const g = this.state.goals.find((x) => x.id === id);
    if (!g) throw new Error('目标不存在: ' + id);
    return g;
  }

  _log(goal, type, message, author = '你') {
    goal.history = goal.history || [];
    goal.history.unshift({
      id: uid('h'),
      ts: now(),
      type,
      message,
      author,
    });
    goal.updatedAt = now();
    goal.progress = computeProgress(goal);
  }

  createGoal({ title, description = '', stage = 'idea', sourceIds = [] }) {
    const ts = now();
    const goal = {
      id: uid('g'),
      title,
      description,
      stage,
      createdAt: ts,
      updatedAt: ts,
      progress: 0,
      tasks: [],
      history: [],
      sourceIds,
      reviewedBy: null,
      reviewNote: '',
      reviewedAt: null,
    };
    goal.progress = computeProgress(goal);
    this._log(goal, 'create', `创建目标，初始阶段「${STAGES.meta[stage].label}」`);
    this.state.goals.unshift(goal);
    return this.state;
  }

  updateGoal(id, patch) {
    const g = this._findGoal(id);
    const allowed = ['title', 'description'];
    for (const k of allowed) if (k in patch) g[k] = patch[k];
    g.progress = computeProgress(g);
    return this.state;
  }

  deleteGoal(id) {
    this.state.goals = this.state.goals.filter((x) => x.id !== id);
    return this.state;
  }

  // Forward stage progression. Moving idea -> requirement requires a human review.
  advanceStage(id, review) {
    const g = this._findGoal(id);
    const idx = STAGES.order.indexOf(g.stage);
    const next = STAGES.order[idx + 1];
    if (!next) throw new Error('该目标已处于最终阶段（部署上线）');
    if (g.stage === 'idea' && next === 'requirement') {
      if (!review || !review.reviewer) {
        throw new Error('从「想法」进入「需求」必须经过人工审核，请提供审核人');
      }
      g.reviewedBy = review.reviewer;
      g.reviewNote = review.note || '';
      g.reviewedAt = now();
    }
    const from = STAGES.meta[g.stage].label;
    g.stage = next;
    this._log(
      g,
      'stage',
      `阶段推进：${from} → ${STAGES.meta[next].label}` +
        (review && review.reviewer ? `（审核人：${review.reviewer}）` : '')
    );
    return this.state;
  }

  // Arbitrary stage move (used by board drag-and-drop). Forward moves that cross
  // the idea -> requirement boundary still require a human review.
  moveGoal(id, toStage, review) {
    const g = this._findGoal(id);
    const fromIdx = STAGES.order.indexOf(g.stage);
    const toIdx = STAGES.order.indexOf(toStage);
    if (toIdx < 0) throw new Error('未知阶段: ' + toStage);
    if (toIdx === fromIdx) return this.state;
    const crossingGate = g.stage === 'idea' && toIdx > fromIdx;
    if (crossingGate && !(review && review.reviewer)) {
      throw new Error('从「想法」推进必须经过人工审核，请提供审核人');
    }
    if (review && review.reviewer) {
      g.reviewedBy = review.reviewer;
      g.reviewNote = review.note || '';
      g.reviewedAt = now();
    }
    const from = STAGES.meta[g.stage].label;
    const to = STAGES.meta[toStage].label;
    g.stage = toStage;
    this._log(
      g,
      'stage',
      `阶段调整（拖拽）：${from} → ${to}` +
        (review && review.reviewer ? `（审核人：${review.reviewer}）` : '')
    );
    return this.state;
  }

  addTask(goalId, text) {
    const g = this._findGoal(goalId);
    g.tasks.push({ id: uid('t'), text, done: false, createdAt: now() });
    this._log(g, 'task', `新增任务：${text}`);
    return this.state;
  }

  toggleTask(goalId, taskId) {
    const g = this._findGoal(goalId);
    const t = g.tasks.find((x) => x.id === taskId);
    if (!t) throw new Error('任务不存在');
    t.done = !t.done;
    this._log(g, 'task', `${t.done ? '完成' : '重开'}任务：${t.text}`);
    return this.state;
  }

  removeTask(goalId, taskId) {
    const g = this._findGoal(goalId);
    g.tasks = g.tasks.filter((x) => x.id !== taskId);
    this._log(g, 'task', `移除任务`);
    return this.state;
  }

  addInboxItem({ channelId, title, content = '', source = 'manual', author = 'you' }) {
    const item = {
      id: uid('in'),
      channelId,
      title,
      content,
      source,
      author,
      createdAt: now(),
      status: 'pending',
      linkedGoalId: null,
      reviewedAt: null,
    };
    this.state.inbox.unshift(item);
    return this.state;
  }

  // Approve / reject a knowledge-base item. Approval can spawn an Idea-stage goal.
  reviewInboxItem(id, decision, opts = {}) {
    const item = this.state.inbox.find((x) => x.id === id);
    if (!item) throw new Error('灵感条目不存在');
    item.reviewedAt = now();
    if (decision === 'approve') {
      item.status = 'approved';
      if (opts.createGoal !== false) {
        const goal = {
          id: uid('g'),
          title: item.title,
          description: item.content,
          stage: 'idea',
          createdAt: now(),
          updatedAt: now(),
          progress: 0,
          tasks: [],
          history: [],
          sourceIds: [item.id],
          reviewedBy: null,
          reviewNote: '',
          reviewedAt: null,
        };
        goal.progress = computeProgress(goal);
        this._log(goal, 'create', `由知识库灵感「${item.title}」经审核进入想法阶段`);
        this.state.goals.unshift(goal);
        item.linkedGoalId = goal.id;
      }
    } else {
      item.status = 'rejected';
    }
    return this.state;
  }

  addChannel({ name, description = '' }) {
    const clean = name.startsWith('#') ? name : '#' + name;
    this.state.channels.push({ id: uid('c'), name: clean, description, type: 'source' });
    return this.state;
  }

  updateConnector(id, patch) {
    const c = this.state.connectors.find((x) => x.id === id);
    if (!c) throw new Error('连接器不存在');
    c.enabled = patch.enabled !== undefined ? patch.enabled : c.enabled;
    c.config = { ...c.config, ...(patch.config || {}) };
    return this.state;
  }

  importFromFile(channelId, text, filename = '') {
    const blocks = text
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    let count = 0;
    for (const b of blocks) {
      const firstLine = b.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80);
      this.addInboxItem({
        channelId,
        title: firstLine || '未命名灵感',
        content: b,
        source: 'file',
        author: filename || 'file',
      });
      count++;
    }
    return this.state;
  }

  async runCodex(goalId, mode = 'plan') {
    const g = this._findGoal(goalId);
    const { runCodex } = require('./codex');
    const res = await runCodex(g, this.state.settings, mode);
    if (res.tasks && res.tasks.length) {
      for (const t of res.tasks) {
        g.tasks.push({ id: uid('t'), text: t, done: false, createdAt: now() });
      }
    }
    this._log(g, 'codex', res.message, 'Codex');
    return this.state;
  }

  // Vibe Coding: generate a runnable project from the goal's requirement using
  // the local open-source agent (Aider + local LLM). Records generated files and
  // advances requirement -> 开发. `onLog` streams the engine output to the caller.
  async vibeCode(goalId, opts = {}) {
    const g = this._findGoal(goalId);
    if (g.stage === 'idea') {
      throw new Error('请先将目标推进到「需求」阶段，再执行 Vibe Coding');
    }
    g.agentLog = g.agentLog || [];
    const inspirations = (g.sourceIds || [])
      .map((id) => this.state.inbox.find((i) => i.id === id))
      .filter(Boolean);
    const userOnLog = opts.onLog;
    const onLog = (m) => {
      g.agentLog.push(m);
      if (userOnLog) userOnLog(m);
    };
    const { generate } = require('./vibecode');
    const result = await generate(g, this.state.settings, {
      projectsDir: opts.projectsDir,
      inspirations,
      onLog,
    });
    if (g.stage === 'requirement') this.advanceStage(goalId);
    g.projectDir = result.projectDir;
    g.generatedFiles = g.generatedFiles || [];
    for (const f of result.files) {
      g.generatedFiles.push({ path: typeof f === 'string' ? f : f.path, addedAt: now() });
    }
    this._log(
      g,
      'codex',
      `⚡ Vibe Coding（${result.engine}）生成 ${result.files.length} 个文件，已进入开发阶段`,
      'VibeFlow AI'
    );
    return this.state;
  }

  // Offline scaffold (no LLM) — deterministic templates, instant, zero dependency.
  async vibeScaffold(goalId, opts = {}) {
    const g = this._findGoal(goalId);
    if (g.stage === 'idea') {
      throw new Error('请先将目标推进到「需求」阶段，再执行离线脚手架');
    }
    const { scaffold } = require('./vibecode');
    const result = await scaffold(g, { projectsDir: opts.projectsDir });
    if (g.stage === 'requirement') this.advanceStage(goalId);
    g.projectDir = result.projectDir;
    g.generatedFiles = g.generatedFiles || [];
    for (const f of result.files) {
      g.generatedFiles.push({ path: f, addedAt: now() });
    }
    this._log(g, 'codex', `📦 离线脚手架生成 ${result.files.length} 个文件（无 LLM）`, 'VibeFlow');
    return this.state;
  }

  async importFromGithub(repo, channelId) {
    const { importGithub } = require('./github');
    const result = await importGithub(repo, channelId, this.state);
    if (result.error) throw new Error(result.error);
    if (result.items && result.items.length) {
      for (const it of result.items) {
        this.addInboxItem({
          channelId,
          title: it.title,
          content: it.content,
          source: 'github',
          author: it.author || repo,
        });
      }
    }
    return this.state;
  }
}

module.exports = { Store, computeProgress, STAGES };
