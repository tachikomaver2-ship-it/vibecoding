"""
tools.py - 研究 Agent 工具集
===========================
提供网络搜索、URL 阅读、引用格式化等核心工具。
所有工具返回统一结构: {success, data, error, tokens_used}

设计原则:
- 仅使用 Python 标准库 + urllib（零额外依赖）
- 每个工具内置容错，失败时优雅降级
- 返回结构化字典，方便主 Agent 统一处理
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Any

# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------

class _HTMLStripper(HTMLParser):
    """轻量级 HTML 标签剥离器，仅保留可见文本。"""

    def __init__(self) -> None:
        super().__init__()
        self._pieces: list[str] = []
        self._skip = False  # 跳过 <script>/<style> 内容

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style", "noscript"):
            self._skip = True

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript"):
            self._skip = False

    def handle_data(self, data: str) -> None:
        if not self._skip:
            text = data.strip()
            if text:
                self._pieces.append(text)

    def get_text(self) -> str:
        return " ".join(self._pieces)


def _strip_html(html: str) -> str:
    """移除 HTML 标签，返回纯文本。"""
    stripper = _HTMLStripper()
    stripper.feed(html)
    return stripper.get_text()


def _rough_token_count(text: str) -> int:
    """粗略估算 token 数量（中英文混合场景）。
    
    规则:
    - 英文: 每 4 个字符约 1 token
    - 中文: 每 1.5 个字符约 1 token
    """
    cn_chars = len(re.findall(r"[\u4e00-\u9fff]", text))
    other_chars = len(text) - cn_chars
    return int(cn_chars / 1.5 + other_chars / 4)


# ---------------------------------------------------------------------------
# 公开工具
# ---------------------------------------------------------------------------

def web_search(
    query: str,
    num_results: int = 5,
    *,
    search_api_url: str | None = None,
) -> dict[str, Any]:
    """网络搜索工具。

    尝试通过 DuckDuckGo HTML 版本进行搜索；若网络不可用或解析失败，
    则回退到基于查询关键词生成的 stub（演示）结果，确保 Agent 流程不中断。

    Args:
        query: 搜索关键词
        num_results: 期望返回的结果数量（默认 5）
        search_api_url: 可选的自定义搜索 API 地址

    Returns:
        标准结构字典 {success, data, error, tokens_used}
        data 为 list[dict]，每项包含 {title, url, snippet}
    """
    # --- 尝试真实搜索（DuckDuckGo HTML 版） ---
    results: list[dict[str, str]] = []
    real_search_succeeded = False

    try:
        encoded = urllib.parse.urlencode({"q": query, "kl": ""})
        url = search_api_url or f"https://html.duckduckgo.com/html/?{encoded}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Research Agent)"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")

        # 简易解析 DuckDuckGo HTML 结果
        # 匹配 class="result__a" 中的链接和标题
        link_pattern = re.compile(
            r'class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>',
            re.DOTALL,
        )
        snippet_pattern = re.compile(
            r'class="result__snippet"[^>]*>(.*?)</(?:a|span|div)',
            re.DOTALL,
        )
        links = link_pattern.findall(body)
        snippets = snippet_pattern.findall(body)

        for i, (raw_url, raw_title) in enumerate(links[:num_results]):
            title = _strip_html(raw_title).strip()
            snippet = _strip_html(snippets[i]).strip() if i < len(snippets) else ""
            # DuckDuckGo 的链接可能经过重定向包装
            if "uddg=" in raw_url:
                raw_url = urllib.parse.unquote(raw_url.split("uddg=")[-1].split("&")[0])
            results.append({"title": title, "url": raw_url, "snippet": snippet})

        if results:
            real_search_succeeded = True

    except Exception:
        # 网络不可用或解析失败，静默降级
        pass

    # --- 回退: 生成 stub 结果 ---
    if not real_search_succeeded:
        stub_domains = [
            "en.wikipedia.org",
            "arxiv.org",
            "www.nature.com",
            "www.sciencedirect.com",
            "pubmed.ncbi.nlm.nih.gov",
        ]
        for i in range(min(num_results, len(stub_domains))):
            slug = query.lower().replace(" ", "-")[:40]
            results.append({
                "title": f"[Stub] {query} - 搜索结果 {i + 1}",
                "url": f"https://{stub_domains[i]}/wiki/{slug}",
                "snippet": (
                    f"这是关于「{query}」的模拟搜索摘要。"
                    "实际部署时请配置有效的搜索 API（如 SerpAPI、Bing API 等）。"
                ),
            })

    # 估算 token 消耗
    all_text = " ".join(r["title"] + r["snippet"] for r in results)
    tokens = _rough_token_count(all_text)

    return {
        "success": True,
        "data": results,
        "error": None,
        "tokens_used": tokens,
        "source": "live" if real_search_succeeded else "stub",
    }


def read_url(url: str, *, max_chars: int = 8000) -> dict[str, Any]:
    """抓取指定 URL 的页面内容并提取纯文本。

    Args:
        url: 目标 URL
        max_chars: 最大返回字符数（防止 token 爆炸）

    Returns:
        标准结构字典 {success, data, error, tokens_used}
        data 为 str（纯文本内容）
    """
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Research Agent)",
                "Accept": "text/html,application/xhtml+xml,*/*",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read(max_chars * 3)  # 多读一些，之后剥离标签会缩减
            content_type = resp.headers.get("Content-Type", "")
            # 尝试从 Content-Type 获取编码
            charset = "utf-8"
            if "charset=" in content_type:
                charset = content_type.split("charset=")[-1].strip()
            html = raw.decode(charset, errors="replace")

        text = _strip_html(html)
        # 截断
        if len(text) > max_chars:
            text = text[:max_chars] + "\n...[内容已截断]"

        tokens = _rough_token_count(text)
        return {
            "success": True,
            "data": text,
            "error": None,
            "tokens_used": tokens,
        }

    except urllib.error.HTTPError as e:
        return {
            "success": False,
            "data": "",
            "error": f"HTTP {e.code}: {e.reason}",
            "tokens_used": 0,
        }
    except urllib.error.URLError as e:
        return {
            "success": False,
            "data": "",
            "error": f"网络错误: {e.reason}",
            "tokens_used": 0,
        }
    except Exception as e:
        return {
            "success": False,
            "data": "",
            "error": f"未知错误: {type(e).__name__}: {e}",
            "tokens_used": 0,
        }


def format_citation(
    source: dict[str, str],
    index: int,
    *,
    style: str = "markdown",
) -> str:
    """将来源信息格式化为 Markdown 引用。

    Args:
        source: 来源字典 {title, url, snippet}
        index: 引用编号（从 1 开始）
        style: 输出格式，目前仅支持 "markdown"

    Returns:
        格式化后的引用字符串
    """
    title = source.get("title", "未知标题")
    url = source.get("url", "")
    snippet = source.get("snippet", "")

    if style == "markdown":
        lines = [
            f"[{index}] **{title}**",
            f"    URL: {url}",
        ]
        if snippet:
            lines.append(f"    > {snippet[:200]}")
        return "\n".join(lines)
    else:
        return f"[{index}] {title} - {url}"
