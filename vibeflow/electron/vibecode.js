// Local-first Vibe Coding engine (NO external/cloud dependency by default).
//
// Default engine: Aider — https://github.com/Aider-AI/aider
//   An open-source, MIT-licensed coding agent. When backed by a *local* LLM
//   (e.g. Ollama running qwen2.5-coder) it runs 100% offline. We shell out to
//   the aider CLI, stream its output, then scan the generated project dir.
//
// Optional opt-in: settings.agent.cloud.{enabled,baseURL,apiKey,model} falls
//   back to an OpenAI-compatible endpoint — only if the user explicitly turns
//   it on. It is OFF by default so the tool never phones home.
//
// Offline fallback: scaffold() — deterministic templates, no LLM, instant.
//
// Pipeline (generate):
//   1. Build a requirement prompt from the goal (title + description + tasks +
//      approved inspirations).
//   2. Spawn `aider` in projects/<goalId>/ with the prompt as a one-shot msg.
//   3. Stream aider's output via onLog (caller surfaces it live).
//   4. After aider exits, scan the dir for generated files.
//   5. Return { files, log, projectDir, engine }.

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

function slug(s) {
  return (
    (s || 'project')
      .toLowerCase()
      .replace(/[^\w一-龥]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  );
}

function projectDirFor(goalId, projectsDir) {
  return path.join(projectsDir || '.', goalId);
}

function detectStack(goal) {
  const text = ((goal.title || '') + ' ' + (goal.description || '')).toLowerCase();
  if (/(react|vue|前端|页面|ui|网页|web ?app|浏览器|小程序)/.test(text)) return 'react';
  if (/(api|后端|服务|server|接口|rest|微服务|网关)/.test(text)) return 'express';
  if (/(cli|命令行|终端|command ?line|脚本工具|bat|shell)/.test(text)) return 'cli';
  return 'node';
}

function stackLabel(s) {
  return { react: 'React 前端', express: 'Node/Express 服务', cli: 'Node CLI', node: 'Node 脚本' }[s] || s;
}

function scanDir(dir, rel = '') {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...scanDir(full, r));
    else out.push(r);
  }
  return out;
}

function findAgent(command) {
  try {
    const r = spawnSync(command, ['--version'], { timeout: 8000, windowsHide: true });
    return r.error ? null : command;
  } catch (e) {
    return null;
  }
}

function buildPrompt(goal, inspirations, related) {
  const L = [];
  L.push(`# 产品目标：${goal.title}`);
  if (goal.description) L.push(`\n## 需求描述\n${goal.description}`);
  const tasks = goal.tasks || [];
  if (tasks.length) {
    L.push('\n## 任务清单（请尽量覆盖）');
    for (const t of tasks) L.push(`- ${t.text}`);
  }
  if (inspirations && inspirations.length) {
    L.push('\n## 参考灵感（来自知识库）');
    for (const s of inspirations) L.push(`- ${s.title}：${s.content}`);
  }
  if (related && related.length) {
    L.push('\n## 相关知识库（kbase · 已沉淀的知识点，供借鉴）');
    for (const r of related) {
      L.push(`- 《${r.title}》：${r.snippet || ''}`);
    }
  }
  L.push('\n## 任务');
  L.push('请基于以上需求，生成一个可直接运行的最小可行项目，包含完整的源码文件与一个 README.md。');
  L.push('要求：代码完整、可运行；目录结构清晰；在关键处用中文写注释。不要解释，直接产出文件。');
  return L.join('\n');
}

function runLocalAgent(goal, settings, opts) {
  const agent = settings.agent || {};
  const command = agent.command || 'aider';
  const model = agent.model || 'ollama/qwen2.5-coder:latest';
  const projectDir = projectDirFor(goal.id, opts.projectsDir);
  fs.mkdirSync(projectDir, { recursive: true });

  return new Promise((resolve, reject) => {
    if (!findAgent(command)) {
      return reject(
        new Error(
          '未找到本地 Vibe Coding 引擎（' +
            command +
            '）。请安装开源工具 Aider：\n' +
            '  pip install aider-chat\n' +
            '并准备一个本地模型（以 Ollama 为例）：\n' +
            '  brew install ollama && ollama pull qwen2.5-coder\n' +
            'ollama 启动后默认在 11434 端口，Aider 即可离线生成代码。'
        )
      );
    }

    const log = [];
    log.push('🚀 启动本地引擎 ' + command + '（模型 ' + model + '）');
    log.push('📁 工作目录 ' + projectDir);
    log.push('📝 已提交需求，等待本地模型生成…（全程不依赖任何外部服务）');

    const args = [
      '--model', model,
      '--no-auto-commits',
      '--no-git',
      '--yes',
      '-m', buildPrompt(goal, opts.inspirations, opts.related),
    ];

    const child = spawn(command, args, { cwd: projectDir, env: process.env });
    const onChunk = (d) => {
      const s = d.toString();
      for (const line of s.split('\n')) {
        if (line.trim()) {
          log.push(line);
          if (opts.onLog) opts.onLog(line);
        }
      }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('error', (e) => reject(new Error('引擎启动失败：' + e.message)));
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error('引擎退出码 ' + code + '。日志末尾：\n' + log.slice(-25).join('\n')));
      }
      const files = scanDir(projectDir);
      log.push('✅ 生成完成，共 ' + files.length + ' 个文件');
      resolve({ files, log, projectDir, engine: 'aider' });
    });
  });
}

// ---- Optional cloud fallback (only when explicitly enabled) -------------------

function parseFiles(content) {
  const lines = content.split('\n');
  const files = [];
  let cur = null;
  let buf = [];
  const re = /^###\s+(\S+\.\w+)\s*$/;
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      if (cur) files.push({ path: cur, content: buf.join('\n') });
      cur = m[1];
      buf = [];
    } else if (cur !== null) {
      buf.push(line);
    }
  }
  if (cur) files.push({ path: cur, content: buf.join('\n') });
  return files;
}

async function callCloudLLM(goal, cloud) {
  const baseURL = (cloud.baseURL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = baseURL + '/chat/completions';
  const model = cloud.model || 'gpt-4o-mini';
  const prompt =
    `你是一个 vibe coding 代理。请根据下面的产品需求，生成可直接运行的完整项目代码。\n\n` +
    `目标：${goal.title}\n需求：${goal.description || '（无）'}\n\n` +
    `要求：输出多个文件；每个文件前以 "### 相对路径" 开头；不要解释性文字；代码要完整可运行并包含 README.md。`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cloud.apiKey },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: '你是资深全栈工程师，严格按 ### 路径格式输出文件，不要多余解释。' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error('云端接口 ' + res.status);
  const data = await res.json();
  const content = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
  const files = parseFiles(content);
  if (!files.length) throw new Error('云端返回未解析到文件');
  return files;
}

// ---- Offline scaffold templates (no LLM) -------------------------------------

function templates(goal) {
  const name = slug(goal.title);
  const title = goal.title || '未命名项目';
  const desc = goal.description || '（暂无需求描述）';
  const stack = detectStack(goal);
  const files = [];

  const pkg = (extra = {}) =>
    JSON.stringify({ name, version: '0.1.0', private: true, description: desc, ...extra }, null, 2);

  const readme = `# ${title}

> 由 **VibeFlow** 根据目标需求生成的初始脚手架（离线模式，无 LLM）。

## 需求描述
${desc}

## 技术栈
${stackLabel(stack)}

## 使用
\`\`\`bash
npm install
npm run dev
\`\`\`

> 这是基于需求关键词生成的初始脚手架，请在基础上继续完善业务逻辑。
`;

  if (stack === 'react') {
    files.push({
      path: 'package.json',
      content: pkg({ type: 'module', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { '@vitejs/plugin-react': '^4.3.1', vite: '^5.4.0' } }),
    });
    files.push({
      path: 'index.html',
      content: `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>${title}</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>
`,
    });
    files.push({ path: 'src/main.jsx', content: `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App />);\n` });
    files.push({
      path: 'src/App.jsx',
      content: `import { useState } from 'react';\n// 需求：${desc}\nexport default function App() {\n  const [n, setN] = useState(0);\n  return <main><h1>${title}</h1><p>${desc}</p><button onClick={() => setN(n + 1)}>点 {n}</button></main>;\n}\n`,
    });
  } else if (stack === 'express') {
    files.push({
      path: 'package.json',
      content: pkg({ main: 'src/index.js', scripts: { start: 'node src/index.js' }, dependencies: { express: '^4.19.2' } }),
    });
    files.push({
      path: 'src/index.js',
      content: `const express = require('express');\n// 需求：${desc}\nconst app = express();\napp.get('/', (_q, r) => r.json({ name: '${title}', ok: true }));\napp.listen(3000, () => console.log('${title} on :3000'));\n`,
    });
  } else if (stack === 'cli') {
    files.push({
      path: 'package.json',
      content: pkg({ bin: { [name]: 'src/cli.js' }, scripts: { start: 'node src/cli.js' } }),
    });
    files.push({
      path: 'src/cli.js',
      content: `#!/usr/bin/env node\n// 需求：${desc}\nconst [,, ...args] = process.argv;\nconsole.log('${title} args:', args);\n`,
    });
  } else {
    files.push({
      path: 'package.json',
      content: pkg({ main: 'src/index.js', scripts: { start: 'node src/index.js' } }),
    });
    files.push({
      path: 'src/index.js',
      content: `// 需求：${desc}\nconsole.log('Hello from ${title}');\n`,
    });
  }
  files.push({ path: 'README.md', content: readme });
  return { stack, files };
}

// ---- Public API ---------------------------------------------------------------

async function generate(goal, settings, opts = {}) {
  const cloud = settings.agent && settings.agent.cloud;
  if (cloud && cloud.enabled && cloud.apiKey) {
    if (opts.onLog) opts.onLog('🌐 已启用云端兼容接口，生成中…');
    const files = await callCloudLLM(goal, cloud);
    const dir = projectDirFor(goal.id, opts.projectsDir);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files) {
      const fp = path.join(dir, f.path);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, f.content, 'utf8');
    }
    return { files: files.map((f) => f.path), log: ['云端生成完成'], projectDir: dir, engine: 'cloud' };
  }
  // Default: local open-source agent (Aider + local LLM).
  return await runLocalAgent(goal, settings, opts);
}

function scaffold(goal, opts = {}) {
  const dir = projectDirFor(goal.id, opts.projectsDir);
  const { files } = templates(goal);
  const log = ['📦 离线脚手架（不调用任何外部服务，无 LLM）'];
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const fp = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, f.content, 'utf8');
    log.push('📄 ' + f.path);
  }
  return { files: files.map((f) => f.path), log, projectDir: dir, engine: 'scaffold' };
}

module.exports = {
  generate,
  scaffold,
  buildPrompt,
  runLocalAgent,
  detectStack,
  stackLabel,
  templates,
  parseFiles,
};
