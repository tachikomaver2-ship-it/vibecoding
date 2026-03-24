---
name: claude-blog-monitor
description: Monitor Anthropic's official research blog for new AI technology posts, generate XHS (Xiaohongshu) style tech blog posts with cover images, and publish to Xiaohongshu. Use when: (1) checking for new Anthropic/Claude research articles, (2) setting up daily blog digest notifications, (3) fetching latest AI research from anthropic.com/research, (4) publishing tech blog posts to Xiaohongshu/小红书, (5) generating cover images for blog posts. Triggers on requests about Claude blog, Anthropic research updates, AI tech blog monitoring, daily research digests, or Xiaohongshu publishing.
---

# Claude Blog Monitor + XHS Publisher

Monitor https://www.anthropic.com/research for new posts, generate tech blog content, and publish to Xiaohongshu.

## 1. Check for New Articles

```bash
python3 scripts/fetch_blog.py
```

- First run: all articles are "new" (initializes state)
- Subsequent runs: only new articles reported
- State: `memory/claude-blog-state.json`
- `--check` flag: list all without updating state

## 2. Generate Cover Image

```bash
python3 scripts/gen_cover.py "标题" "日期"
```

Output: `/tmp/openclaw/uploads/xhs_cover.png`

For full control, import and call `generate_cover()` with:
- `title`: Chinese title
- `date`: e.g. "2026年3月24日"  
- `points`: list of 3-5 bullet points with emoji
- `summary`: 1-2 sentence summary
- `output_path`: PNG path

## 3. Publish to Xiaohongshu (Browser Automation)

Prerequisites: OpenClaw browser (openclaw profile) logged into creator.xiaohongshu.com

### Flow:
1. Run `fetch_blog.py` to get new articles
2. For each new article, fetch full content via `web_fetch`
3. Generate Chinese XHS-style blog content (title ≤20 chars, body ≤1000 chars)
4. Generate cover image with `gen_cover.py`
5. Browser automation:
   a. Navigate to `https://creator.xiaohongshu.com/publish/publish`
   b. Click "上传图文" tab
   c. Upload cover: arm `browser upload`, click file chooser
   d. Set title via JS: `document.querySelector('input[placeholder="填写标题会有更多赞哦"]')`
   e. Set body via JS: `document.querySelector('.tiptap.ProseMirror')` (contentEditable div)
   f. Click "发布" button

### Title Input (JS):
```javascript
const input = document.querySelector('input[placeholder="填写标题会有更多赞哦"]');
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(input, 'YOUR TITLE');
input.dispatchEvent(new Event('input', { bubbles: true }));
```

### Body Input (JS):
```javascript
const editor = document.querySelector('.tiptap.ProseMirror');
editor.focus();
editor.innerHTML = '<p>paragraph 1</p><p>paragraph 2</p>';
editor.dispatchEvent(new Event('input', { bubbles: true }));
```

## 4. XHS Content Style Guide

- Title: ≤20 chars, use ｜ separator, catchy
- Body: use emoji headers (📊🔍💡), numbered lists (1️⃣2️⃣), ≤1000 chars
- Tags: #AI技术 #Anthropic #Claude #人工智能 #技术博客
- Cover: dark tech style, Chinese text, 1080x1440px
- Tone: informative but accessible, not too academic

## 5. Daily Automation

Cron job `claude-blog-daily` runs at 9:00 AM CST:
- Checks for new articles
- If found: generates content + cover, publishes to XHS
- If none: stays silent

## State Files
- `memory/claude-blog-state.json` — tracked article URLs
- OpenClaw browser cookies — XHS login session
