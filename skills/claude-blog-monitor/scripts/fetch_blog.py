#!/usr/bin/env python3
"""Fetch latest posts from Anthropic's research page and detect new entries."""

import json
import re
import ssl
import sys
import os
from urllib.request import urlopen, Request
from html.parser import HTMLParser
from datetime import datetime

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

STATE_FILE = os.environ.get(
    "BLOG_STATE_FILE",
    os.path.expanduser("~/.openclaw/workspace/memory/claude-blog-state.json"),
)

URLS = [
    "https://www.anthropic.com/research",
]

# Pattern to match dates like "Mar 24, 2026"
DATE_PATTERN = re.compile(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}")

# Categories/teams to filter out
SKIP_PREFIXES = ("/research/team/",)


class LinkExtractor(HTMLParser):
    """Extract article links and titles from Anthropic pages."""

    def __init__(self):
        super().__init__()
        self.articles = []
        self._in_a = False
        self._href = ""
        self._text_parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            attrs_dict = dict(attrs)
            href = attrs_dict.get("href", "")
            if href and "/research/" in href:
                if not any(href.startswith(p) or ("anthropic.com" + p) in href for p in SKIP_PREFIXES):
                    self._in_a = True
                    self._href = href
                    self._text_parts = []

    def handle_data(self, data):
        if self._in_a:
            self._text_parts.append(data.strip())

    def handle_endtag(self, tag):
        if tag == "a" and self._in_a:
            raw = " ".join(p for p in self._text_parts if p)
            if raw and self._href:
                url = self._href
                if url.startswith("/"):
                    url = "https://www.anthropic.com" + url

                # Parse structured text: "Mar 24, 2026 Category Title"
                date_match = DATE_PATTERN.search(raw)
                date_str = ""
                category = ""
                title = raw

                if date_match:
                    date_str = date_match.group(0)
                    after_date = raw[date_match.end():].strip()
                    # Known categories
                    cats = [
                        "Economic Research", "Science", "Alignment",
                        "Interpretability", "Societal Impacts", "Policy",
                        "Announcements", "Frontier Red Team", "Engineering",
                    ]
                    for c in cats:
                        if after_date.startswith(c):
                            category = c
                            title = after_date[len(c):].strip()
                            break
                    else:
                        title = after_date if after_date else raw
                else:
                    # For featured articles with embedded descriptions, extract just the title
                    # Pattern: "Category Date Title Description..."
                    # Skip these longer entries or truncate to first sentence
                    for c in ["Alignment", "Interpretability", "Societal Impacts", "Policy",
                              "Economic Research", "Science", "Announcements", "Engineering",
                              "Frontier Red Team"]:
                        if raw.startswith(c):
                            after_cat = raw[len(c):].strip()
                            dm = DATE_PATTERN.search(after_cat)
                            if dm:
                                date_str = dm.group(0)
                                rest = after_cat[dm.end():].strip()
                                # Title is up to first long description
                                title = rest.split(". ")[0] if rest else raw
                                category = c
                                break

                self.articles.append({
                    "title": title,
                    "url": url,
                    "date": date_str,
                    "category": category,
                })
            self._in_a = False
            self._href = ""
            self._text_parts = []


def fetch_page(url: str) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (OpenClaw-BlogMonitor/1.0)"})
    with urlopen(req, timeout=15, context=SSL_CTX) as resp:
        return resp.read().decode("utf-8", errors="replace")


def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"seen_urls": []}


def save_state(state: dict):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def main():
    check_only = "--check" in sys.argv
    all_articles = []

    for url in URLS:
        try:
            html = fetch_page(url)
            parser = LinkExtractor()
            parser.feed(html)
            all_articles.extend(parser.articles)
        except Exception as e:
            print(f"⚠️ Failed to fetch {url}: {e}", file=sys.stderr)

    # Deduplicate by URL
    seen = set()
    unique = []
    for a in all_articles:
        if a["url"] not in seen:
            seen.add(a["url"])
            unique.append(a)
    all_articles = unique

    if check_only:
        print(json.dumps(all_articles, indent=2, ensure_ascii=False))
        return

    # Compare with saved state
    state = load_state()
    seen_urls = set(state.get("seen_urls", []))

    new_articles = [a for a in all_articles if a["url"] not in seen_urls]

    if new_articles:
        print(f"🆕 Found {len(new_articles)} new article(s):\n")
        for a in new_articles:
            cat = f" [{a['category']}]" if a.get("category") else ""
            date = f" ({a['date']})" if a.get("date") else ""
            print(f"• **{a['title']}**{cat}{date}")
            print(f"  {a['url']}\n")
    else:
        print("✅ No new articles since last check.")

    # Update state
    state["seen_urls"] = list(set(state.get("seen_urls", [])) | {a["url"] for a in all_articles})
    state["last_check"] = datetime.now().isoformat()
    state["total_tracked"] = len(state["seen_urls"])
    save_state(state)

    # Output JSON for programmatic use
    result = {
        "new_count": len(new_articles),
        "new_articles": new_articles,
        "total_tracked": state["total_tracked"],
        "checked_at": state["last_check"],
    }
    print("\n---JSON---")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
