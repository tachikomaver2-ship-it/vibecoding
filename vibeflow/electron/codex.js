// Codex-style AI assist. Calls the OpenAI-compatible Chat Completions API when a
// key is configured, otherwise returns a deterministic heuristic plan so the app
// is fully usable offline / without a key.

const STAGES = require('../shared/stages.json');

function heuristic(goal, mode) {
  const stage = goal.stage;
  const base = [
    '梳理目标范围与验收标准',
    '搭建项目骨架与目录结构',
    '实现核心功能 MVP',
    '补充错误处理与边界用例',
    '编写基础测试',
  ];
  if (mode === 'code') {
    return {
      message: `（离线模式）已根据「${goal.title}」生成实现任务清单，建议从项目骨架开始。`,
      tasks: base.slice(1, 4),
    };
  }
  return {
    message: `（离线模式）已为「${goal.title}」在「${STAGES.meta[stage].label}」阶段建议 ${base.length} 项任务。`,
    tasks: base,
  };
}

async function runCodex(goal, settings, mode = 'plan') {
  const key = settings && settings.codexApiKey;
  if (!key) return heuristic(goal, mode);

  const model = settings.codexModel || 'gpt-4o-mini';
  const stageLabel = STAGES.meta[goal.stage].label;
  const prompt =
    `你是一个软件工程代理（类似 Codex）。目标：「${goal.title}」。\n` +
    `描述：${goal.description || '（无）'}\n当前阶段：${stageLabel}。\n` +
    `请返回 JSON：{"summary":"一句话总结", "tasks":["3-6 个具体、可执行的任务，中文"]}。`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是资深软件工程师，只输出 JSON。' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error('API ' + res.status);
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message.content;
    const parsed = JSON.parse(content);
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.map(String) : [];
    return {
      message: `Codex（${model}）：${parsed.summary || '已生成任务清单'}（${tasks.length} 项）`,
      tasks,
    };
  } catch (e) {
    return { message: `Codex 调用失败，回退到离线建议：${e.message}`, tasks: heuristic(goal, mode).tasks };
  }
}

module.exports = { runCodex };
