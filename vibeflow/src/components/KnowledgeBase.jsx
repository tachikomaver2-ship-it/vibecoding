import { useEffect, useState } from 'react';
import { timeAgo } from '../lib/format.js';
import * as api from '../api.js';

export function KnowledgeBase({ notify }) {
  const [stats, setStats] = useState({ enabled: false, docs: 0, dir: '' });
  const [list, setList] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [s, l] = await Promise.all([api.kbaseStats(), api.kbaseList()]);
      setStats(s);
      setList(l);
    } catch (e) {
      notify('错误：' + e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const search = async () => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    setBusy(true);
    try {
      const r = await api.kbaseSearch({ query: query.trim(), topK: 8 });
      setResults(r);
    } catch (e) {
      notify('错误：' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults(null);
  };

  const openDir = () =>
    api.kbaseOpen().catch((e) => notify('错误：' + e.message));

  const shown = results || list;

  return (
    <div className="kbase">
      <section className="panel">
        <div className="panel-head">
          <span>🔍 检索知识库（kbase · LLM-Wiki）</span>
          <button className="link-btn" onClick={openDir}>
            打开目录
          </button>
        </div>
        <div className="kbase-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="用自然语言描述你想找的知识点，例如：语音记录灵感"
          />
          <button className="btn primary" onClick={search} disabled={busy}>
            检索
          </button>
          {results && (
            <button className="btn" onClick={clearSearch}>
              全部
            </button>
          )}
        </div>
        <p className="muted small">
          底层为开源 LLM-Wiki（<b>kbase</b>）：每条灵感以 markdown 落盘到 <code>raw/</code> +
          <code> wiki/</code>，并用本地 BM25 索引做语义检索，<b>不依赖任何外部服务</b>。
          当前共 {stats.docs} 篇知识。
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>{results ? `检索结果（${results.length}）` : `全部知识（${list.length}）`}</span>
          <span className="muted">{results ? '按相关度排序' : '按收录顺序'}</span>
        </div>
        <ul className="kbase-list">
          {shown.map((d) => (
            <li key={d.id} className="kbase-item">
              <div className="kbase-top">
                <span className="kbase-title">{d.title}</span>
                {d.adopted && <span className="status-badge approved">已采纳</span>}
              </div>
              {results && d.snippet && <div className="kbase-snippet">{d.snippet}</div>}
              <div className="kbase-meta muted">
                {d.channel && '#' + d.channel + ' · '}
                {d.source} · {timeAgo(Date.parse(d.createdAt) || 0)}
                {d.score != null && ` · 相关度 ${(d.score).toFixed(2)}`}
              </div>
            </li>
          ))}
          {shown.length === 0 && <li className="muted">知识库还是空的，去「灵感收件箱」添加一条吧。</li>}
        </ul>
      </section>
    </div>
  );
}
