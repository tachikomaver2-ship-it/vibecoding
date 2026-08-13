// kbase — local-first LLM-Wiki knowledge base (kbase-compatible).
//
// Backend for VibeFlow's "灵感 / 知识库" feature. Mirrors the open-source
// LLM-Wiki project kbase (https://gitee.com/dxdbc/kbase) on-disk layout so the
// same directory can later be overlaid by the real kbase MCP server:
//
//   kbase/
//     raw/      # 原始资料（未加工灵感原文）
//     wiki/     # 结构化知识页面（可被语义检索）
//     thoughts/ # 个人思想宝库（预留）
//     kbase-index.json  # 本地 BM25 倒排索引
//
// No external service is required: inspirations are stored as markdown and
// searched with a lightweight BM25 index (CJK handled via character bigrams,
// Latin via word tokens). The real kbase's Qdrant + bge-m3 pipeline can be
// plugged in later without changing the file layout.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Tokenize for indexing / search. CJK -> character bigrams (good recall for
// Chinese); Latin/number runs -> lowercase word tokens.
function tokenize(text) {
  const tokens = [];
  const str = String(text || '');
  const latin = str.toLowerCase().match(/[a-z0-9][a-z0-9._+-]*/g) || [];
  tokens.push(...latin);
  const cjk = str.match(/[一-鿿㐀-䶿]/g) || [];
  if (cjk.length === 1) tokens.push(cjk[0]);
  for (let i = 0; i < cjk.length - 1; i++) tokens.push(cjk[i] + cjk[i + 1]);
  return tokens;
}

class KBase {
  constructor(rootDir) {
    this.root = rootDir;
    this.rawDir = path.join(rootDir, 'raw');
    this.wikiDir = path.join(rootDir, 'wiki');
    this.thoughtsDir = path.join(rootDir, 'thoughts');
    this.indexFile = path.join(rootDir, 'kbase-index.json');
    this._ensure();
  }

  _ensure() {
    for (const d of [this.root, this.rawDir, this.wikiDir, this.thoughtsDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
    const rawIdx = path.join(this.rawDir, 'index.md');
    if (!fs.existsSync(rawIdx)) {
      fs.writeFileSync(rawIdx, '# 原始资料 (raw)\n\n自动沉淀的灵感原文，未加工。\n');
    }
    const wikiIdx = path.join(this.wikiDir, 'index.md');
    if (!fs.existsSync(wikiIdx)) {
      fs.writeFileSync(wikiIdx, '# 知识库 (wiki)\n\n结构化后的知识页面，可被语义检索。\n');
    }
    // Always rebuild the index from the wiki files on startup so a stale or
    // corrupt kbase-index.json can never serve wrong results.
    this._rebuildIndex();
  }

  _slug(s) {
    const out = String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[^\w一-鿿]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36);
    return out || 'untitled';
  }

  _newId() {
    return 'kb_' + crypto.randomUUID().slice(0, 10);
  }

  // Persist an inspiration as a kbase document. Returns the written metadata.
  add({ title, content = '', channel = '', source = 'manual', author = 'you', tags = [] }) {
    const id = this._newId();
    const ts = new Date().toISOString();
    const base = `${this._slug(title)}-${id}`;
    const rawPath = path.join(this.rawDir, base + '.md');
    const wikiPath = path.join(this.wikiDir, base + '.md');

    const rawMd = [
      '---',
      `id: ${id}`,
      `title: ${JSON.stringify(title)}`,
      `source: ${source}`,
      `channel: ${channel}`,
      `author: ${author}`,
      `createdAt: ${ts}`,
      '---',
      '',
      `# ${title}`,
      '',
      content || '(无内容)',
      '',
    ].join('\n');
    fs.writeFileSync(rawPath, rawMd);

    const wikiMd = [
      '---',
      `id: ${id}`,
      `title: ${JSON.stringify(title)}`,
      `channel: ${channel}`,
      `source: ${source}`,
      `author: ${author}`,
      `tags: ${JSON.stringify(tags)}`,
      `createdAt: ${ts}`,
      'adopted: false',
      '---',
      '',
      `# ${title}`,
      '',
      `> 来源：${source} · ${channel || '—'} · ${author} · ${ts}`,
      '',
      '## 内容',
      '',
      content || '(无内容)',
      '',
      '## 关联',
      '',
      `- 原始资料：raw/${path.basename(rawPath)}`,
      '',
    ].join('\n');
    fs.writeFileSync(wikiPath, wikiMd);

    this._appendCatalog(this.rawDir, title, base + '.md');
    this._appendCatalog(this.wikiDir, title, base + '.md');
    this._rebuildIndex();
    return { id, rawPath, wikiPath, title, channel, source, author, tags, createdAt: ts };
  }

  _appendCatalog(dir, title, file) {
    try {
      fs.appendFileSync(path.join(dir, 'index.md'), `- [${title}](./${file})\n`);
    } catch (e) {
      /* non-fatal */
    }
  }

  markAdopted(id, value = true) {
    const doc = this._findWiki(id);
    if (!doc) return false;
    let txt = fs.readFileSync(doc.path, 'utf8');
    if (/^adopted:\s*(true|false)\s*$/m.test(txt)) {
      txt = txt.replace(/^adopted:\s*(true|false)\s*$/m, 'adopted: ' + value);
    } else {
      txt = txt.replace(/^(createdAt:.*)$/m, `$1\nadopted: ${value}`);
    }
    fs.writeFileSync(doc.path, txt);
    this._rebuildIndex();
    return true;
  }

  _findWiki(id) {
    const files = fs
      .readdirSync(this.wikiDir)
      .filter((f) => f.endsWith('.md') && f !== 'index.md');
    for (const f of files) {
      const txt = fs.readFileSync(path.join(this.wikiDir, f), 'utf8');
      if (new RegExp('^id:\\s*' + id + '\\s*$', 'm').test(txt)) {
        return { path: path.join(this.wikiDir, f), name: f };
      }
    }
    return null;
  }

  _parseFront(txt) {
    const m = txt.match(/^---\n([\s\S]*?)\n---/);
    const fm = {};
    if (!m) return fm;
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      if (v.startsWith('[')) {
        try {
          v = JSON.parse(v);
        } catch (e) {
          /* keep string */
        }
      }
      fm[k] = v;
    }
    return fm;
  }

  _stripFront(txt) {
    return txt.replace(/^---\n[\s\S]*?\n---\n?/, '');
  }

  _buildIndex() {
    const files = fs
      .readdirSync(this.wikiDir)
      .filter((f) => f.endsWith('.md') && f !== 'index.md');
    const docs = [];
    const df = {};
    for (const f of files) {
      const txt = fs.readFileSync(path.join(this.wikiDir, f), 'utf8');
      const fm = this._parseFront(txt);
      if (!fm.id) continue;
      const body = this._stripFront(txt);
      const tokens = tokenize((fm.title || '') + ' ' + body);
      const tf = {};
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      // df = document frequency (distinct docs containing the term), NOT the
      // raw occurrence count — otherwise df can exceed N and break BM25's IDF.
      for (const t of new Set(tokens)) df[t] = (df[t] || 0) + 1;
      docs.push({
        id: fm.id,
        title: fm.title || f,
        channel: fm.channel || '',
        source: fm.source || '',
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        createdAt: fm.createdAt || '',
        path: f,
        length: tokens.length,
        tf,
        adopted: fm.adopted === 'true' || fm.adopted === true,
      });
    }
    const N = docs.length;
    const avgdl = N ? docs.reduce((s, d) => s + d.length, 0) / N : 0;
    return { docs, df, N, avgdl, builtAt: Date.now() };
  }

  _rebuildIndex() {
    const idx = this._buildIndex();
    try {
      fs.writeFileSync(this.indexFile, JSON.stringify(idx));
    } catch (e) {
      /* non-fatal */
    }
    return idx;
  }

  _loadIndex() {
    try {
      return JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch (e) {
      return this._rebuildIndex();
    }
  }

  _snippet(filePath, query) {
    let body;
    try {
      body = this._stripFront(fs.readFileSync(filePath, 'utf8')).replace(/\s+/g, ' ').trim();
    } catch (e) {
      return '';
    }
    const q = String(query || '');
    let idx = -1;
    const latin = q.toLowerCase().match(/[a-z0-9][a-z0-9._+-]*/g) || [];
    for (const w of latin) {
      const i = body.toLowerCase().indexOf(w);
      if (i >= 0) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      const cjk = q.match(/[一-鿿㐀-䶿]/g) || [];
      const joined = cjk.join('');
      for (let i = 0; i < joined.length - 1; i++) {
        const j = body.indexOf(joined.slice(i, i + 2));
        if (j >= 0) {
          idx = j;
          break;
        }
      }
      if (idx < 0 && cjk.length) idx = body.indexOf(cjk[0]);
    }
    if (idx < 0) return body.slice(0, 100);
    const start = Math.max(0, idx - 30);
    return (start > 0 ? '…' : '') + body.slice(start, start + 100) + '…';
  }

  // BM25 search over wiki pages. Returns ranked results with snippets.
  search(query, topK = 5) {
    const idx = this._loadIndex();
    if (!idx.N) return [];
    const qTokens = tokenize(query);
    if (!qTokens.length) return [];
    const qtf = {};
    for (const t of qTokens) qtf[t] = (qtf[t] || 0) + 1;
    const k1 = 1.5;
    const b = 0.75;
    const results = [];
    for (const doc of idx.docs) {
      let score = 0;
      for (const t of Object.keys(qtf)) {
        const f = doc.tf[t] || 0;
        if (!f) continue;
        const df_t = idx.df[t] || 0;
        if (!df_t) continue;
        const idf = Math.log(1 + (idx.N - df_t + 0.5) / (df_t + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / (idx.avgdl || 1))));
      }
      if (score > 0) {
        results.push({
          id: doc.id,
          title: doc.title,
          channel: doc.channel,
          source: doc.source,
          tags: doc.tags,
          createdAt: doc.createdAt,
          adopted: doc.adopted,
          score,
          path: doc.path,
        });
      }
    }
    results.sort((a, c) => c.score - a.score);
    const top = results.slice(0, topK);
    for (const r of top) r.snippet = this._snippet(path.join(this.wikiDir, r.path), query);
    return top;
  }

  list() {
    const idx = this._loadIndex();
    return idx.docs.map((d) => ({
      id: d.id,
      title: d.title,
      channel: d.channel,
      source: d.source,
      tags: d.tags,
      createdAt: d.createdAt,
      adopted: d.adopted,
    }));
  }

  getWiki(id) {
    const doc = this._findWiki(id);
    if (!doc) return null;
    return fs.readFileSync(doc.path, 'utf8');
  }

  count() {
    try {
      return this._loadIndex().N;
    } catch (e) {
      return 0;
    }
  }

  stats() {
    return { enabled: true, docs: this.count(), dir: this.root };
  }
}

module.exports = { KBase, tokenize };
