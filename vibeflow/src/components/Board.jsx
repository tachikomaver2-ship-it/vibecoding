import { useState } from 'react';
import { STAGES } from '../lib/format.js';
import { GoalCard } from './GoalCard.jsx';

export function Board({ state, onOpen, onMoveGoal }) {
  const [dragOver, setDragOver] = useState(null);
  const inboxById = Object.fromEntries((state.inbox || []).map((i) => [i.id, i]));
  const columns = STAGES.order.map((stage) => ({
    stage,
    meta: STAGES.meta[stage],
    goals: (state.goals || []).filter((g) => g.stage === stage),
  }));

  const onDrop = (e, toStage) => {
    e.preventDefault();
    setDragOver(null);
    const goalId = e.dataTransfer.getData('text/goal-id');
    if (!goalId) return;
    onMoveGoal(goalId, toStage);
  };

  return (
    <div className="board">
      {columns.map((col) => (
        <div
          key={col.stage}
          className={'board-col' + (dragOver === col.stage ? ' drag-over' : '')}
          style={{ borderTopColor: col.meta.color }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragOver !== col.stage) setDragOver(col.stage);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget)) return;
            if (dragOver === col.stage) setDragOver(null);
          }}
          onDrop={(e) => onDrop(e, col.stage)}
        >
          <div className="board-col-head">
            <span className="dot" style={{ background: col.meta.color }} />
            <span className="board-col-title">{col.meta.label}</span>
            <span className="board-col-count">{col.goals.length}</span>
          </div>
          <div className="board-col-sub">{col.meta.description}</div>
          <div className="board-col-body">
            {col.goals.length === 0 && <div className="empty-col">暂无目标</div>}
            {col.goals.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                sources={(g.sourceIds || []).map((id) => inboxById[id]).filter(Boolean)}
                onOpen={onOpen}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
