---
name: claude-blog-monitor
description: Monitor Anthropic's official research blog for new AI technology posts and deliver daily summaries. Use when: (1) checking for new Anthropic/Claude research articles, (2) setting up daily blog digest notifications, (3) fetching latest AI research from anthropic.com/research. Triggers on requests about Claude blog, Anthropic research updates, AI tech blog monitoring, or daily research digests.
---

# Claude Blog Monitor

Monitor https://www.anthropic.com/research for new posts and notify the user.

## Quick Check

Run the fetch script to detect new articles:

```bash
python3 scripts/fetch_blog.py
```

- First run: all articles are "new" (initializes state)
- Subsequent runs: only articles not previously seen are reported
- State stored in `memory/claude-blog-state.json`
- Use `--check` flag to list all articles without updating state

## Daily Push Setup

Set up a cron job to check once daily and push new articles to the user:

```
openclaw cron add --name claude-blog-daily \
  --schedule "0 9 * * *" \
  --task "Run python3 skills/claude-blog-monitor/scripts/fetch_blog.py in the workspace. If there are new articles (new_count > 0), send a summary to the user with titles, categories, dates, and links. If no new articles, stay silent (do not notify). Format the message nicely for the user's platform."
```

Adjust the schedule as needed (default: 9:00 AM daily).

## Output Format

When new articles are found, format the notification as:

```
🔔 Anthropic 研究博客更新

• **[Title]** [Category] (Date)
  Link

...共 N 篇新文章
```

## State Management

- State file: `memory/claude-blog-state.json`
- Contains: `seen_urls`, `last_check`, `total_tracked`
- Delete state file to reset and re-detect all articles as new
