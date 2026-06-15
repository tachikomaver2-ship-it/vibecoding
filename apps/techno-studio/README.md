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
