import { useEffect, useState } from 'react';
import * as api from './api.js';
import { STAGES } from './lib/format.js';
import { Sidebar } from './components/Sidebar.jsx';
import { Board } from './components/Board.jsx';
import { Inbox } from './components/Inbox.jsx';
import { KnowledgeBase } from './components/KnowledgeBase.jsx';
import { Connectors } from './components/Connectors.jsx';
import { Activity } from './components/Activity.jsx';
import { GoalDetail } from './components/GoalDetail.jsx';

const VIEW_TITLE = {
  board: '目标看板 · 开发阶段一览',
  inbox: '灵感收件箱 · 知识库沉淀',
  kbase: '知识库 · kbase LLM-Wiki',
  connectors: '连接器 · 平台知识库接入',
  activity: '动态 · 全局活动时间线',
};

export default function App() {
  const [state, setState] = useState(null);
  const [view, setView] = useState('board');
  const [selectedGoalId, setSelectedGoalId] = useState(null);
  const [activeChannel, setActiveChannel] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState(null);
  const [reviewGoalId, setReviewGoalId] = useState(null);

  useEffect(() => {
    api.getState().then(setState);
    const off = api.onChange(setState);
    return off;
  }, []);

  const refresh = (r) => setState(r || state);
  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  // Board drag-and-drop: move a goal to a target stage. Moving out of 想法 still
  // requires the human review gate, so we open a review modal instead of moving.
  const moveGoal = async (goalId, toStage) => {
    const g = state.goals.find((x) => x.id === goalId);
    if (!g || g.stage === toStage) return;
    const crossingGate = g.stage === 'idea' && STAGES.order.indexOf(toStage) > STAGES.order.indexOf('idea');
    if (crossingGate) {
      setReviewGoalId(goalId);
      return;
    }
    try {
      const r = await api.moveGoal({ id: goalId, toStage });
      refresh(r);
      notify('已移动到「' + STAGES.meta[toStage].label + '」');
    } catch (e) {
      notify('错误：' + e.message);
    }
  };

  if (!state) return <div className="loading">加载中…</div>;

  const selectedGoal = state.goals.find((g) => g.id === selectedGoalId) || null;
  if (selectedGoalId && !selectedGoal) setSelectedGoalId(null);

  return (
    <div className="app">
      <Sidebar
        state={state}
        view={view}
        setView={setView}
        activeChannel={activeChannel}
        setActiveChannel={setActiveChannel}
      />

      <main className="main">
        <header className="topbar">
          <h1>{VIEW_TITLE[view]}</h1>
          <div className="topbar-actions">
            <span className="stat">目标 {state.goals.length}</span>
            <span className="stat">待审核 {(state.inbox || []).filter((i) => i.status === 'pending').length}</span>
            <button className="btn primary" onClick={() => setShowCreate(true)}>
              + 新建目标
            </button>
          </div>
        </header>

        <div className="content">
          {view === 'board' && <Board state={state} onOpen={setSelectedGoalId} onMoveGoal={moveGoal} />}
          {view === 'inbox' && (
            <Inbox state={state} activeChannel={activeChannel} refresh={refresh} notify={notify} onOpenKb={() => setView('kbase')} />
          )}
          {view === 'kbase' && <KnowledgeBase state={state} refresh={refresh} notify={notify} />}
          {view === 'connectors' && <Connectors state={state} refresh={refresh} notify={notify} />}
          {view === 'activity' && <Activity state={state} />}
        </div>
      </main>

      {selectedGoal && (
        <GoalDetail
          key={selectedGoal.id}
          goal={selectedGoal}
          state={state}
          onClose={() => setSelectedGoalId(null)}
          refresh={refresh}
          notify={notify}
        />
      )}

      {showCreate && (
        <CreateModal
          state={state}
          onClose={() => setShowCreate(false)}
          refresh={refresh}
          notify={notify}
          onCreated={(id) => {
            setShowCreate(false);
            setView('board');
            setSelectedGoalId(id);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}

      {reviewGoalId && (
        <BoardReviewModal
          goal={state.goals.find((g) => g.id === reviewGoalId)}
          onClose={() => setReviewGoalId(null)}
          refresh={refresh}
          notify={notify}
        />
      )}
    </div>
  );
}

function CreateModal({ state, onClose, refresh, notify, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState('idea');
  const [sourceId, setSourceId] = useState('');

  const pending = (state.inbox || []).filter((i) => i.status === 'pending');

  const create = async () => {
    if (!title.trim()) {
      notify('请填写目标标题');
      return;
    }
    try {
      const r = await api.createGoal({
        title: title.trim(),
        description,
        stage,
        sourceIds: sourceId ? [sourceId] : [],
      });
      refresh(r);
      const newId = r.goals[0]?.id;
      notify('目标已创建');
      onCreated(newId);
    } catch (e) {
      notify('错误：' + e.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>新建目标</h3>
        <label>标题</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="目标名称" />
        <label>描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="产品想法 / 范围 / 验收标准"
        />
        <label>初始阶段</label>
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          {STAGES.order.map((s) => (
            <option key={s} value={s}>
              {STAGES.meta[s].label}
            </option>
          ))}
        </select>
        <label>关联灵感（可选）</label>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">不关联</option>
          {pending.map((i) => (
            <option key={i.id} value={i.id}>
              {i.title}
            </option>
          ))}
        </select>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={create}>
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

function BoardReviewModal({ goal, onClose, refresh, notify }) {
  const [reviewer, setReviewer] = useState('我');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!goal) return null;
  const targetStage = STAGES.order[STAGES.order.indexOf(goal.stage) + 1] || 'requirement';

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.moveGoal({ id: goal.id, toStage: targetStage, review: { reviewer, note } });
      refresh(r);
      notify('审核通过，已推进到「' + STAGES.meta[targetStage].label + '」');
      onClose();
    } catch (e) {
      notify('错误：' + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>人工审核：{STAGES.meta[goal.stage].label} → {STAGES.meta[targetStage].label}</h3>
        <p className="muted">拖拽移动触发门禁：想法阶段的灵感需经人工审核通过，才能进入需求阶段。</p>
        <label>审核人</label>
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
        <label>审核意见</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例如：需求清晰，可进入开发"
        />
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            通过审核并移动
          </button>
        </div>
      </div>
    </div>
  );
}
