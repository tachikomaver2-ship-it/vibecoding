"""GitHub 集成：把确认后的优化补丁提交成新分支 + Pull Request。"""
from __future__ import annotations

import base64
import time

import httpx

API = "https://api.github.com"


class GitHubError(RuntimeError):
    pass


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "agentloop-harness",
    }


def _check(resp: httpx.Response, action: str) -> dict:
    if resp.status_code >= 300:
        raise GitHubError(f"{action} 失败 [{resp.status_code}] {resp.text[:400]}")
    return resp.json() if resp.content else {}


def whoami(token: str) -> dict:
    with httpx.Client(timeout=20) as c:
        return _check(c.get(f"{API}/user", headers=_headers(token)), "校验 Token")


def get_repo(token: str, owner: str, repo: str) -> dict:
    with httpx.Client(timeout=20) as c:
        return _check(c.get(f"{API}/repos/{owner}/{repo}", headers=_headers(token)), "读取仓库")


def get_file(token: str, owner: str, repo: str, path: str, ref: str) -> str | None:
    """读取文件文本内容，不存在返回 None。"""
    with httpx.Client(timeout=20) as c:
        r = c.get(f"{API}/repos/{owner}/{repo}/contents/{path}", headers=_headers(token), params={"ref": ref})
        if r.status_code == 404:
            return None
        data = _check(r, f"读取 {path}")
    if isinstance(data, list):
        return None
    try:
        return base64.b64decode(data.get("content", "")).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


def ensure_branch(token: str, owner: str, repo: str, branch: str, from_branch: str) -> None:
    with httpx.Client(timeout=20) as c:
        h = _headers(token)
        r = c.get(f"{API}/repos/{owner}/{repo}/git/ref/heads/{branch}", headers=h)
        if r.status_code == 200:
            return
        src = c.get(f"{API}/repos/{owner}/{repo}/git/ref/heads/{from_branch}", headers=h)
        base_sha = _check(src, f"读取基线分支 {from_branch}")["object"]["sha"]
        _check(
            c.post(f"{API}/repos/{owner}/{repo}/git/refs", headers=h,
                   json={"ref": f"refs/heads/{branch}", "sha": base_sha}),
            f"创建分支 {branch}",
        )


def put_file(token: str, owner: str, repo: str, branch: str, path: str,
             content: str, message: str, sha: str | None = None) -> dict:
    body: dict = {"message": message, "content": base64.b64encode(content.encode("utf-8")).decode(), "branch": branch}
    if sha:
        body["sha"] = sha
    with httpx.Client(timeout=30) as c:
        return _check(
            c.put(f"{API}/repos/{owner}/{repo}/contents/{path}", headers=_headers(token), json=body),
            f"写入 {path}",
        )


def file_sha(token: str, owner: str, repo: str, path: str, ref: str) -> str | None:
    with httpx.Client(timeout=20) as c:
        r = c.get(f"{API}/repos/{owner}/{repo}/contents/{path}", headers=_headers(token), params={"ref": ref})
        if r.status_code == 404:
            return None
        data = _check(r, f"读取 {path} 元信息")
    return data.get("sha") if isinstance(data, dict) else None


def create_pr(token: str, owner: str, repo: str, head: str, base: str, title: str, body: str) -> dict:
    with httpx.Client(timeout=30) as c:
        return _check(
            c.post(f"{API}/repos/{owner}/{repo}/pulls", headers=_headers(token),
                   json={"title": title, "head": head, "base": base, "body": body}),
            "创建 Pull Request",
        )


def submit_optimization(token: str, owner: str, repo: str, base_branch: str,
                        opt: dict, case_index: dict[int, dict]) -> dict:
    """把一条优化建议提交为分支 + PR。

    提交内容：
      1. 目标文件的新版本（skill / prompt / entity-map）
      2. harness/optimizations/<slug>.md —— 变更说明 + 关联 BadCase + 评分差异
      3. harness/cases/<case_key>.json —— 关联案例的可回放快照索引
    """
    slug = f"opt-{opt['id']}-{int(time.time())}"
    branch = f"harness/{slug}"
    ensure_branch(token, owner, repo, branch, base_branch)

    steps: list[dict] = []
    target = opt.get("target_path") or "prompts/agent.md"

    sha = file_sha(token, owner, repo, target, branch)
    res = put_file(
        token, owner, repo, branch, target, opt.get("new_content") or "",
        f"harness: 应用优化建议 #{opt['id']} — {opt['title']}", sha,
    )
    steps.append({"path": target, "commit": res.get("commit", {}).get("sha", ""),
                  "html_url": res.get("content", {}).get("html_url", "")})

    case_lines = []
    for cid in opt.get("case_ids") or []:
        c = case_index.get(cid)
        if not c:
            continue
        case_lines.append(
            f"| {c.get('case_key')} | {c.get('title')} | {c.get('fault_type')} | "
            f"{c.get('root_cause_entity') or c.get('entity_key')} | {c.get('difficulty')} |"
        )
    doc = [
        f"# 优化建议 #{opt['id']}：{opt['title']}",
        "",
        f"- 类别：`{opt.get('category')}`",
        f"- 目标文件：`{target}`",
        f"- 生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 状态：已由人工确认后提交",
        "",
        "## 为什么改",
        "",
        opt.get("rationale", ""),
        "",
        "## 关联 BadCase",
        "",
    ]
    if case_lines:
        doc += ["| case_key | 标题 | 故障类型 | 根因实体 | 难度 |", "| --- | --- | --- | --- | --- |"] + case_lines
    else:
        doc.append("_该建议来自运行轨迹的成本/循环分析，无单一关联案例。_")
    doc += [
        "",
        "## 变更 diff",
        "",
        "```diff",
        (opt.get("patch") or "").strip(),
        "```",
        "",
        "## 验收方式",
        "",
        "1. 切到本分支，导入案例快照：`harness case import harness/cases/*.json`",
        "2. 跑回放：`harness replay --suite <collection> --baseline`",
        "3. 对比综合分与各维度分：定因 40% / 定界 30% / 过程 30%，通过阈值 0.75",
        "",
        "> 由 AgentLoop Harness 自动生成，人工确认后提交。",
        "",
    ]
    res2 = put_file(token, owner, repo, branch, f"harness/optimizations/{slug}.md", "\n".join(doc),
                    f"harness: 优化建议 #{opt['id']} 变更说明", None)
    steps.append({"path": f"harness/optimizations/{slug}.md",
                  "commit": res2.get("commit", {}).get("sha", ""),
                  "html_url": res2.get("content", {}).get("html_url", "")})

    for cid in (opt.get("case_ids") or [])[:20]:
        c = case_index.get(cid)
        if not c:
            continue
        import json
        res3 = put_file(token, owner, repo, branch, f"harness/cases/{c['case_key']}.json",
                        json.dumps(c, ensure_ascii=False, indent=2),
                        f"harness: 沉淀案例 {c['case_key']}", None)
        steps.append({"path": f"harness/cases/{c['case_key']}.json",
                      "commit": res3.get("commit", {}).get("sha", ""),
                      "html_url": res3.get("content", {}).get("html_url", "")})

    pr = create_pr(
        token, owner, repo, branch, base_branch,
        f"[Harness] {opt['title']}",
        body="\n".join([
            f"由 **AgentLoop Harness** 基于 BadCase 分析生成，人工确认后提交。",
            "",
            f"- 建议 ID：#{opt['id']}",
            f"- 类别：`{opt.get('category')}` → `{target}`",
            f"- 关联 BadCase：{len(opt.get('case_ids') or [])} 个",
            f"- 说明文档：`harness/optimizations/{slug}.md`",
            "",
            "### 变更理由",
            "",
            opt.get("rationale", ""),
            "",
            "### diff 摘要",
            "",
            "```diff",
            "\n".join((opt.get("patch") or "").splitlines()[:60]),
            "```",
        ]),
    )
    return {
        "branch": branch,
        "files": steps,
        "pr_number": pr.get("number"),
        "pr_url": pr.get("html_url"),
        "base": base_branch,
    }
