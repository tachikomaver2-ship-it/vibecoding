import { stageMeta, timeAgo } from '../lib/format.js';
import { ProgressBar } from './ProgressBar.jsx';

export function GoalCard({ goal, sources, onOpen }) {
  const meta = stageMeta(goal.stage);
  const tasks = goal.tasks || [];
  const done = tasks.filter((t) => t.done).length;
  const pending = goal.stage === 'idea' && !goal.reviewedBy;

  const onDragStart = (e) => {
    e.dataTransfer.setData('text/goal-id', goal.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className="goal-card"
      style={{ borderLeftColor: meta.color }}
      draggable
      onDragStart={onDragStart}
      onClick={() => onOpen(goal.id)}
    >
      <div className="goal-card-top">
        <span className="stage-chip" style={{ background: meta.color + '22', color: meta.color }}>
          {meta.label}
        </span>
        {pending && <span className="badge-warn">待审核</span>}
      </div>
      <div className="goal-card-title">{goal.title}</div>
      <ProgressBar value={goal.progress} color={meta.color} />
      <div className="goal-card-foot">
        <span>✅ {done}/{tasks.length} 任务</span>
        {sources?.length ? <span>💡 {sources.length} 灵感</span> : null}
        <span className="muted">{timeAgo(goal.updatedAt)}</span>
      </div>
    </div>
  );
}
