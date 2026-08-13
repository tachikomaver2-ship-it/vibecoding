import { useState } from 'react';
import { timeAgo } from '../lib/format.js';
import * as api from '../api.js';

export function Inbox({ state, activeChannel, refresh, notify }) {
  const channels = state.channels || [];
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [channelId, setChannelId] = useState((channels[0] || {}).id || '');
  const [source, setSource] = useState('manual');
  const [fileText, setFileText] = useState('');
  const [fileName, setFileName] = useState('');
  const [repo, setRepo] = useState('');

  const items = (state.inbox || []).filter(
    (i) => activeChannel === 'all' || i.channelId === activeChannel
  );

  async function call(fn) {
    try {
      const r = await fn();
      refresh(r);
      return r;
    } catch (e) {
      notify('错误：' + e.message);
    }
  }

  const addItem = () => {
    if (!title.trim()) return;
    const t = title.trim();
    setTitle('');
    setContent('');
    call(() =>
      api.addInboxItem({ channelId: channelId || channels[0]?.id, title: t, content, source })
    );
  };
  const review = (id, decision) =>
    call(() => api.reviewInboxItem({ id, decision, opts: {} }));
  const doFile = () =>
    call(() =>
      api.importFromFile({ channelId: channelId || channels[0]?.id, text: fileText, filename: fileName })
    ).then((r) => {
      if (r) {
        notify('已从文件导入灵感');
        setFileText('');
      }
    });
  const doGithub = () =>
    call(() =>
      api.importFromGithub({ repo: repo.trim(), channelId: channelId || channels[0]?.id })
    ).then((r) => {
      if (r) {
        notify('已从 GitHub 导入灵感（见收件箱）');
        setRepo('');
      }
    });

  return (
    <div className="inbox">
      <div className="inbox-grid">
        <section className="panel">
          <div className="panel-head">
            <span>新增灵感到知识库</span>
          </div>
          <div className="form">
            <input
              placeholder="灵感标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              placeholder="内容 / 链接 / 摘录…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <div className="row">
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="manual">手动</option>
                <option value="podcast">播客</option>
                <option value="article">文章</option>
                <option value="social">社媒</option>
                <option value="clip">剪贴板</option>
              </select>
            </div>
            <button className="btn primary" onClick={addItem}>
              添加到知识库
            </button>
          </div>

          <div className="panel-head" style={{ marginTop: 16 }}>
            <span>从文件批量导入</span>
          </div>
          <div className="form">
            <input
              placeholder="文件名（可选）"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
            <textarea
              placeholder="粘贴多篇内容，用空行分隔，每篇首行作为标题"
              value={fileText}
              onChange={(e) => setFileText(e.target.value)}
            />
            <button className="btn" onClick={doFile} disabled={!fileText.trim()}>
              导入
            </button>
          </div>

          <div className="panel-head" style={{ marginTop: 16 }}>
            <span>从 GitHub Issues 导入</span>
          </div>
          <div className="form">
            <input
              placeholder="owner/repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            />
            <button className="btn" onClick={doGithub} disabled={!repo.trim()}>
              拉取 Issue 作为灵感
            </button>
            <p className="muted small">需本机已安装并登录 gh CLI。</p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span>灵感收件箱（待审核 → 想法）</span>
            <span className="muted">{items.length} 条</span>
          </div>
          <ul className="inbox-list">
            {items.map((it) => (
              <li key={it.id} className={'inbox-item status-' + it.status}>
                <div className="inbox-top">
                  <span className="inbox-title">{it.title}</span>
                  <span className={'status-badge ' + it.status}>
                    {it.status === 'pending' ? '待审核' : it.status === 'approved' ? '已采纳' : '已忽略'}
                  </span>
                </div>
                {it.content && <div className="inbox-content">{it.content}</div>}
                <div className="inbox-meta muted">
                  {channels.find((c) => c.id === it.channelId)?.name || '—'} · {it.source} ·{' '}
                  {it.author} · {timeAgo(it.createdAt)}
                  {it.linkedGoalId ? ' · 已生成目标' : ''}
                </div>
                {it.status === 'pending' && (
                  <div className="inbox-actions">
                    <button
                      className="btn primary sm"
                      onClick={() => review(it.id, 'approve')}
                    >
                      审核通过（进入想法）
                    </button>
                    <button className="btn sm" onClick={() => review(it.id, 'reject')}>
                      忽略
                    </button>
                  </div>
                )}
              </li>
            ))}
            {items.length === 0 && <li className="muted">该频道暂无灵感。</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
