import { formatDateTime } from '../lib/format.js';

export function Activity({ state }) {
  const events = [];
  for (const g of state.goals || []) {
    for (const h of g.history || []) {
      events.push({ ...h, goalTitle: g.title, goalId: g.id });
    }
  }
  events.sort((a, b) => b.ts - a.ts);

  return (
    <div className="activity">
      <section className="panel">
        <div className="panel-head">
          <span>#动态 · 全局活动时间线</span>
          <span className="muted">{events.length} 条</span>
        </div>
        <ul className="timeline wide">
          {events.map((e) => (
            <li key={e.id}>
              <div className="tl-body">
                <div className="tl-msg">
                  <strong>{e.goalTitle}</strong> — {e.message}
                </div>
                <div className="tl-meta">
                  {e.author} · {formatDateTime(e.ts)}
                </div>
              </div>
            </li>
          ))}
          {events.length === 0 && <li className="muted">暂无动态。</li>}
        </ul>
      </section>
    </div>
  );
}
