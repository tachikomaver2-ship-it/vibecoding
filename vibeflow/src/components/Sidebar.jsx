const VIEWS = [
  { id: 'board', label: '📋 目标看板', icon: '📋' },
  { id: 'inbox', label: '📥 灵感收件箱', icon: '📥' },
  { id: 'connectors', label: '🔌 连接器', icon: '🔌' },
  { id: 'activity', label: '⚡ 动态', icon: '⚡' },
];

export function Sidebar({ state, view, setView, activeChannel, setActiveChannel }) {
  const channels = state.channels || [];
  const webhookOn = state.settings && state.settings.webhookEnabled;

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-logo">◈</span>
        <span className="brand-name">VibeFlow</span>
      </div>

      <nav className="nav">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={'nav-item' + (view === v.id ? ' active' : '')}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <div className="channels-head">知识库频道</div>
      <div className="channels">
        <button
          className={'channel' + (activeChannel === 'all' ? ' active' : '')}
          onClick={() => setActiveChannel('all')}
        >
          # 全部
        </button>
        {channels.map((c) => (
          <button
            key={c.id}
            className={'channel' + (activeChannel === c.id ? ' active' : '')}
            onClick={() => setActiveChannel(c.id)}
            title={c.description}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="sidebar-foot">
        <span className={'status-dot ' + (webhookOn ? 'on' : 'off')} />
        {webhookOn ? 'Webhook 接收已开启' : 'Webhook 接收关闭'}
      </div>
    </aside>
  );
}
