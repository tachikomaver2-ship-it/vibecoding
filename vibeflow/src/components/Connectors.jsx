import { useState } from 'react';
import * as api from '../api.js';

const TYPE_HINT = {
  manual: '手动粘贴 / 剪贴板，通用入口',
  file: '从 .md / .txt 文件批量导入灵感',
  webhook: '接收外部平台（Slack / Discord / Zapier）POST 的灵感',
  github: '通过 gh CLI 拉取仓库 Issue 作为灵感',
  slack: 'Slack  incoming webhook 转发',
};

export function Connectors({ state, refresh, notify }) {
  const [settings, setSettings] = useState(state.settings || {});

  async function call(fn) {
    try {
      const r = await fn();
      refresh(r);
    } catch (e) {
      notify('错误：' + e.message);
    }
  }

  const toggle = (c) => call(() => api.updateConnector({ id: c.id, patch: { enabled: !c.enabled } }));
  const setConfig = (c, key, val) =>
    call(() => api.updateConnector({ id: c.id, patch: { config: { [key]: val } } }));
  const saveSetting = (key, val) =>
    call(() => api.setSettings({ patch: { [key]: val } })).then(() =>
      setSettings((s) => ({ ...s, [key]: val }))
    );

  const webhookPort = (state.settings && state.settings.webhookPort) || 18720;
  const agent = state.settings?.agent || {};
  const saveAgent = (key, val) =>
    call(() =>
      api.setSettings({ patch: { agent: { ...agent, [key]: val } } })
    ).then(() => setSettings((s) => ({ ...s, agent: { ...agent, [key]: val } })));

  return (
    <div className="connectors">
      <section className="panel">
        <div className="panel-head">
          <span>平台连接器（知识库来源）</span>
        </div>
        <div className="conn-list">
          {(state.connectors || []).map((c) => (
            <div className="conn-card" key={c.id}>
              <div className="conn-head">
                <div>
                  <div className="conn-name">{c.name}</div>
                  <div className="muted small">{TYPE_HINT[c.type] || c.type}</div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={!!c.enabled} onChange={() => toggle(c)} />
                  <span className="slider" />
                </label>
              </div>
              {c.type === 'webhook' && c.enabled && (
                <div className="conn-cfg">
                  <code>http://127.0.0.1:{webhookPort}/webhook</code>
                  <p className="muted small">POST JSON：{'{ title, content, source, author, channelId }'}</p>
                </div>
              )}
              {c.type === 'github' && (
                <div className="conn-cfg">
                  <input
                    placeholder="owner/repo"
                    value={c.config?.repo || ''}
                    onChange={(e) => setConfig(c, 'repo', e.target.value)}
                  />
                </div>
              )}
              {c.type === 'slack' && (
                <div className="conn-cfg">
                  <input
                    placeholder="https://hooks.slack.com/services/..."
                    value={c.config?.webhookUrl || ''}
                    onChange={(e) => setConfig(c, 'webhookUrl', e.target.value)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>⚡ Vibe Coding 引擎（本地·开源）</span>
        </div>
        <p className="muted small">
          默认使用 <b>Aider</b>（开源 coding agent，github.com/Aider-AI/aider）+ 本地模型，完全离线运行。可选开启云端兼容接口。
        </p>
        <div className="form">
          <label>引擎命令</label>
          <input
            value={agent.command || 'aider'}
            onChange={(e) => saveAgent('command', e.target.value)}
            placeholder="aider"
          />
          <label>本地模型（Ollama）</label>
          <input
            value={agent.model || 'ollama/qwen2.5-coder:latest'}
            onChange={(e) => saveAgent('model', e.target.value)}
            placeholder="ollama/qwen2.5-coder:latest"
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>云端兼容接口（可选）</span>
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={!!agent.cloud?.enabled}
            onChange={(e) => saveAgent('cloud', { ...(agent.cloud || {}), enabled: e.target.checked })}
          />
          <span>启用云端模型（默认关闭；开启后将依赖外部服务）</span>
        </label>
        {agent.cloud?.enabled && (
          <div className="form">
            <label>Base URL</label>
            <input
              value={agent.cloud?.baseURL || ''}
              onChange={(e) => saveAgent('cloud', { ...(agent.cloud || {}), baseURL: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
            <label>API Key</label>
            <input
              type="password"
              value={agent.cloud?.apiKey || ''}
              onChange={(e) => saveAgent('cloud', { ...(agent.cloud || {}), apiKey: e.target.value })}
              placeholder="sk-..."
            />
            <label>模型</label>
            <input
              value={agent.cloud?.model || 'gpt-4o-mini'}
              onChange={(e) => saveAgent('cloud', { ...(agent.cloud || {}), model: e.target.value })}
            />
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Webhook 服务</span>
        </div>
        <div className="form">
          <label>监听端口</label>
          <input
            type="number"
            value={webhookPort}
            onChange={(e) => saveSetting('webhookPort', Number(e.target.value))}
          />
          <label className="switch-row">
            <input
              type="checkbox"
              checked={!!(state.settings && state.settings.webhookEnabled)}
              onChange={(e) => saveSetting('webhookEnabled', e.target.checked)}
            />
            <span>启用 Webhook 接收（需重启生效）</span>
          </label>
        </div>
      </section>
    </div>
  );
}
