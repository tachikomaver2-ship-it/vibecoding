# TechnoStudio — AI Techno 编曲社区

用自然语言描述，AI 逐步叠加采样与效果器，编曲、试听、发布、点赞。

## 功能

| 区域 | 说明 |
|------|------|
| **我的编曲区** `/studio` | AI 对话式编曲，叠加 Kick/Bass/Hi-Hat/Lead/Pad，实时试听，发布作品 |
| **编曲发布区** `/feed` | 浏览社区作品，点赞、评论、分享，点赞热榜 |

## 示例提示词流程

```
127bpm, give me 4 notes
→ double it
→ put it in big hall
→ powerful bass
→ distort bass
→ drop
→ kick drum
```

## 技术栈

- **Next.js 16** + TypeScript + Tailwind CSS
- **Tone.js** — 浏览器端音频合成与效果（Reverb、Distortion、Sequencer）
- **JSON 文件存储** — 帖子、点赞、评论（`data/posts.json`）

## 免费采样来源

编曲区底部链接到 Freesound、Looperman、Sample Focus、99Sounds 等免费 Techno 采样站。内置引擎使用 Tone.js 合成 909 Kick、Analog Bass 等，无需下载即可试听。

## 开发

```bash
cd apps/techno-studio
npm install
npm run dev
```

打开 http://localhost:3000

## 部署（Dev / 外网访问）

### 方式一：Vercel（推荐，永久 HTTPS 地址）

1. 打开一键导入：  
   https://vercel.com/new/import?repository-url=https%3A%2F%2Fgithub.com%2Ftachikomaver2-ship-it%2Fvibecoding&project-name=techno-studio-dev&root-directory=apps%2Ftechno-studio&branch=techno

2. 登录 Vercel → 选择 GitHub 仓库 `vibecoding` → 分支 `techno`  
3. Root Directory 设为 `apps/techno-studio` → Deploy  
4. 完成后获得 `https://techno-studio-dev.vercel.app` 类似的外网地址

CLI 部署（需先 `npx vercel login`）：

```bash
cd apps/techno-studio
npx vercel          # preview / dev
npx vercel --prod   # 生产
```

### 方式二：Render（持久化磁盘，适合帖子数据）

1. 打开 https://dashboard.render.com/select-repo?type=blueprint  
2. 连接 GitHub 仓库，选择 `techno` 分支  
3. Render 会自动读取根目录 `render.yaml` 并部署 `techno-studio-dev`

### 方式三：本地隧道（临时 dev 预览）

```bash
npm run build && npm start
npx localtunnel --port 3000
```

首次访问 loca.lt 链接时，页面会要求输入本机公网 IP（或点击 Remind me later）。

## 目录结构

```
src/
  app/
    studio/     # 我的编曲区
    feed/       # 编曲发布区
    post/[id]/  # 作品详情 & 分享页
    api/posts/  # REST API
  components/   # UI 组件
  lib/
    prompt-parser.ts  # 自然语言 → 编曲状态
    audio-engine.ts   # Tone.js 播放引擎
    db.ts             # 帖子存储
```
