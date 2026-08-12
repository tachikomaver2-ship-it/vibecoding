# YouTube Digest Enhanced

> A vibe-coded remix of [Zara Zhang's YouTube Digest](https://github.com/zarazhangrui/youtube-digest), optimized with dark mode, multi-language translation, AI summaries, vocabulary extraction, and more.

![Version](https://img.shields.io/badge/version-2.0.0-c8674f) ![License](https://img.shields.io/badge/license-MIT-blue) ![Chrome](https://img.shields.io/badge/Chrome-116+-4285F4)

## What's New (vs. Original)

| Feature | Original | Enhanced |
|---------|----------|----------|
| **Dark Mode** | Light only | Full dark mode with one-click toggle |
| **Translation** | Simplified Chinese only | 7 languages: 中文, 日本語, 한국어, Español, Français, Deutsch |
| **AI Summary** | Chapters + Key Quotes | + TL;DR (2-3 sentence summary) + Key Terms (vocabulary) |
| **Transcript Search** | None | Real-time search with highlighting |
| **Export** | Plain text | + Markdown export for transcript and notes |
| **Keyboard Shortcuts** | `n` for notes | + `/` search, `j`/`k` navigate, `t` theme, `Esc` clear |
| **UI** | Calm Terracotta (light) | Calm Terracotta (light + dark) |

## Quick Start

### 1. Load the Extension

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `youtube-digest-enhanced` folder

### 2. Configure API Keys

You need two API keys (same as the original):

| Key | Purpose | Where to Get It |
|-----|---------|-----------------|
| **Supadata** | Fetch YouTube transcripts | [dash.supadata.ai](https://dash.supadata.ai/auth/sign-up) (free: 100 requests/month) |
| **DeepSeek** | AI translation, summaries, explanations | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |

Click the extension icon → **Settings** → paste both keys.

### 3. Use It

1. Open any YouTube video **with subtitles**
2. Click the extension icon (or the "Digest" button below the video)
3. The side panel opens with the transcript
4. Switch between **Transcript**, **Overview**, and **Notes** tabs

## Features in Detail

### Dark Mode
- Click the 🌙/☀️ button in the header to toggle
- Preference is saved and restored on next open
- Press `t` to toggle via keyboard

### Multi-Language Translation
- Select from the dropdown in the transcript header
- **Original** — raw transcript
- **中文 / 日本語 / 한국어 / Español / Français / Deutsch** — translated
- **双语 Bilingual** — original + your last selected language side by side
- Translation is lazy and progressive (only translates what you scroll to)

### TL;DR Summary
- Auto-generated when you open the **Overview** tab
- 2-3 sentence summary of the entire video
- Powered by DeepSeek

### Key Terms (Vocabulary)
- 5-10 important terms extracted from the video
- Each term includes a brief definition
- Great for learning new concepts from educational videos

### Transcript Search
- Type in the search bar to find specific moments
- Matching text is highlighted with `<mark>` tags
- Scrolls to the first match automatically
- Press `/` to focus the search bar, `Esc` to clear

### Markdown Export
- **Transcript**: exports full transcript with timestamps as `.md`
- **Notes**: exports all saved notes as `.md`
- Files include video title, channel, and URL metadata

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search bar |
| `Esc` | Clear search |
| `j` | Next transcript entry |
| `k` | Previous transcript entry |
| `t` | Toggle dark mode |
| `n` | Save note (on YouTube page) |

## Architecture

```
youtube-digest-enhanced/
├── manifest.json          # Chrome extension manifest (MV3)
├── background.js          # Service worker — API calls, AI processing
├── content.js             # Injected into YouTube pages — buttons, video info
├── sidepanel.html         # Side panel UI structure
├── sidepanel.css          # All styles (light + dark themes)
├── sidepanel.js           # Side panel logic — rendering, search, shortcuts
├── settings.js            # Configuration defaults and validation
├── options.html/css/js    # Settings page
├── prompts/               # AI prompt templates
│   ├── analysis.md        # Chapter/quote/TL;DR/vocabulary prompts
│   ├── translation.md     # Translation rules per language
│   ├── explain.md         # Text explanation prompt
│   └── note-cleanup.md    # Note cleanup prompt
├── icons/                 # Extension icons
└── tests/                 # Node.js tests
```

## Credits

- **Original project**: [Zara Zhang](https://github.com/zarazhangrui) — [youtube-digest](https://github.com/zarazhangrui/youtube-digest)
- **Enhanced by**: [Ella (tachikomaver2-ship-it)](https://github.com/tachikomaver2-ship-it) — vibe coded with AI agents

## License

MIT — same as the original project.
