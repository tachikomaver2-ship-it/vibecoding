import { useState, useEffect } from 'react';
import { stageMeta, formatDateTime, timeAgo } from '../lib/format.js';
import { ProgressBar } from './ProgressBar.jsx';
import * as api from '../api.js';

const HISTORY_ICON = { create: '➕', stage: '🔀', task: '📝', codex: '🤖', note: '💬' };

export function GoalDetail({ goal, state, onClose, refresh, notify }) {
  const meta = stageMeta(goal.stage);
  const [desc, setDesc] = useState(goal.description || '');
  const [newTask, setNewTask] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [reviewer, setReviewer] = useState('我');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [setupErr, setSetupErr] = useState(null);
  const [related, setRelated] = useState([]);

  useEffect(() => {
    setRelated([]);
    api
      .kbaseSearch({ query: goal.title + ' ' + (goal.description || ''), topK: 3 })
      .then(setRelated)
      .catch(() => {});
  }, [goal.id]);

  const sources = (goal.sourceIds || [])
    .map((id) => state.inbox.find((i) => i.id === id))
    .filter(Boolean);
  const tasks = goal.tasks || [];
  const done = tasks.filter((t) => t.done).length;
  const isIdea = goal.stage === 'idea';
  const isDeployed = goal.stage === 'deploy';

  async function call(fn) {
    setBusy(true);
    try {
      const r = await fn();
      refresh(r);
      return r;
    } catch (e) {
      notify('错误：' + e.message);
    } finally {
      setBusy(false);
    }
  }

  const saveDesc = () => call(() => api.updateGoal({ id: goal.id, patch: { description: desc } }));
  const addTask = () => {
    if (!newTask.trim()) return;
    const t = newTask.trim();
    setNewTask('');
    call(() => api.addTask({ goalId: goal.id, text: t }));
  };
  const toggle = (tid) => call(() => api.toggleTask({ goalId: goal.id, taskId: tid }));
  const rm = (tid) => call(() => api.removeTask({ goalId: goal.id, taskId: tid }));
  const advance = () => call(() => api.advanceStage({ id: goal.id }));
  const submitReview = () =>
    call(() => api.advanceStage({ id: goal.id, review: { reviewer, note } })).then(() =>
      setShowReview(false)
    );
  const codex = (mode) => call(() => api.runCodex({ goalId: goal.id, mode }));
  const openDir = () => call(() => api.openProjectDir({ goalId: goal.id }));
  const vibe = async () => {
    setSetupErr(null);
    setBusy(true);
    try {
      const r = await api.vibeCode({ goalId: goal.id });
      refresh(r);
    } catch (e) {
      setSetupErr(e.message);
      notify('Vibe Coding 引擎未就绪，请按提示安装');
    } finally {
      setBusy(false);
    }
  };
  const scaffold = async () => {
    setSetupErr(null);
    setBusy(true);
    try {
      const r = await api.vibeScaffold({ goalId: goal.id });
      refresh(r);
      notify('离线脚手架已生成');
    } catch (e) {
      notify('错误：' + e.message);
    } finally {
      setBusy(false);
    }
  };
  const del = () => {
    if (!window.confirm('确认删除该目标？此操作不可撤销。')) return;
    call(() => api.deleteGoal({ id: goal.id })).then(() => onClose());
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head" style={{ borderTopColor: meta.color }}>
          <div>
            <span className="stage-chip" style={{ background: meta.color + '22', color: meta.color }}>
              {meta.label}
            </span>
            <h2 className="drawer-title">{goal.title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <section className="panel">
            <div className="panel-head">
              <span>进度</span>
              <span className="muted">{meta.description}</span>
            </div>
            <ProgressBar value={goal.progress} color={meta.color} />
          </section>

          <section className="panel">
            <div className="panel-head">
              <span>描述</span>
              <button className="link-btn" onClick={saveDesc} disabled={busy}>
                保存
              </button>
            </div>
            <textarea
              className="desc-area"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="补充该目标的产品想法、范围或验收标准…"
            />
          </section>

          <section className="panel">
            <div className="panel-head">
              <span>任务进度（{done}/{tasks.length}）</span>
            </div>
            <ul className="task-list">
              {tasks.map((t) => (
                <li key={t.id} className={t.done ? 'done' : ''}>
                  <label>
                    <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} />
                    <span>{t.text}</span>
                  </label>
                  <button className="link-btn danger" onClick={() => rm(t.id)}>
                    删除
                  </button>
                </li>
              ))}
              {tasks.length === 0 && <li className="muted">暂无任务，可用 Codex 自动生成。</li>}
            </ul>
            <div className="task-add">
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTask()}
                placeholder="添加任务，回车确认"
              />
              <button onClick={addTask} disabled={busy}>
                添加
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span>⚡ Vibe Coding（本地·开源引擎）</span>
              <button className="link-btn" onClick={openDir} disabled={busy || !goal.projectDir}>
                打开目录
              </button>
            </div>
            <p className="muted small">
              基于「需求」阶段的标题 / 描述 / 任务 / 灵感，调用本地开源 coding agent（Aider + 本地模型）生成可运行项目，
              <b>不依赖任何外部服务</b>。引擎需在「连接器 / Vibe Coding 引擎」中配置。
            </p>
            <div className="vibe-actions">
              <button className="btn primary" onClick={vibe} disabled={busy || isIdea}>
                ⚡ 用 Aider 本地生成代码
              </button>
              <button className="btn" onClick={scaffold} disabled={busy || isIdea}>
                📦 离线脚手架（无 LLM）
              </button>
            </div>
            {isIdea && <p className="muted small">需先推进到「需求」阶段。</p>}
            {(goal.agentLog || []).length > 0 && (
              <pre className="agent-log">{goal.agentLog.join('\n')}</pre>
            )}
            {setupErr && <pre className="agent-error">{setupErr}</pre>}
            {(goal.generatedFiles || []).length > 0 && (
              <div className="gen-files">
                <div className="muted small">生成文件（{goal.generatedFiles.length}）</div>
                {goal.generatedFiles.map((f, i) => (
                  <div className="file-row" key={i}>
                    📄 {f.path}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <span>历史修改记录</span>
              <span className="muted">{goal.history?.length || 0} 条</span>
            </div>
            <ul className="timeline">
              {(goal.history || []).map((h) => (
                <li key={h.id}>
                  <span className="tl-icon">{HISTORY_ICON[h.type] || '•'}</span>
                  <div className="tl-body">
                    <div className="tl-msg">{h.message}</div>
                    <div className="tl-meta">
                      {h.author} · {formatDateTime(h.ts)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {sources.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <span>来源灵感（知识库）</span>
              </div>
              {sources.map((s) => (
                <div className="source-item" key={s.id}>
                  <div className="source-title">💡 {s.title}</div>
                  <div className="muted">{s.content}</div>
                </div>
              ))}
            </section>
          )}

          {related.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <span>相关知识点（知识库 · kbase）</span>
              </div>
              {related.map((r) => (
                <div className="source-item" key={r.id}>
                  <div className="source-title">🔎 {r.title}</div>
                  <div className="muted">{r.snippet}</div>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="drawer-actions">
          {isIdea ? (
            <button className="btn primary" onClick={() => setShowReview(true)} disabled={busy}>
              提交审核 → 需求
            </button>
          ) : !isDeployed ? (
            <button className="btn primary" onClick={advance} disabled={busy}>
              推进到下一阶段 →
            </button>
          ) : (
            <span className="muted">🎉 已部署上线</span>
          )}
          <button className="btn" onClick={() => codex('plan')} disabled={busy}>
            🤖 Codex 规划
          </button>
          <button className="btn" onClick={() => codex('code')} disabled={busy}>
            🤖 Codex 生成任务
          </button>
          <button className="btn danger" onClick={del} disabled={busy}>
            删除
          </button>
        </div>

        {showReview && (
          <div className="modal-backdrop" onClick={() => setShowReview(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>人工审核：想法 → 需求</h3>
              <p className="muted">想法阶段的灵感需经人工审核通过，才能进入需求阶段。</p>
              <label>审核人</label>
              <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
              <label>审核意见</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：需求清晰，可进入开发"
              />
              <div className="modal-actions">
                <button className="btn" onClick={() => setShowReview(false)}>
                  取消
                </button>
                <button className="btn primary" onClick={submitReview} disabled={busy}>
                  通过审核
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
