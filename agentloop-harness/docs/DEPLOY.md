# 部署指南

## 一、环境要求

| 项 | 要求 |
|---|---|
| Python | ≥ 3.9（已在 **3.13** 上验证） |
| 磁盘 | 约 200 MB（含虚拟环境）；数据库随数据增长 |
| 网络 | 仅 live 回放和 GitHub 提交时出网；其余功能全离线可用 |
| Docker | **不需要** |
| Node.js | **不需要**（前端零构建） |

## 二、本地快速启动

```bash
git clone https://github.com/tachikomaver2-ship-it/vibecoding.git -b harness-loop
cd vibecoding/agentloop-harness

./run.sh --seed
# 控制台   http://127.0.0.1:8848/
# API 文档 http://127.0.0.1:8848/api/docs
# 账号     admin / admin123
```

`run.sh` 会做四件事：建 `.venv` → 装依赖 → 写演示数据 → 起 uvicorn。

### 参数

```bash
./run.sh                  # 只启动
./run.sh --seed           # 先写演示数据再启动
./run.sh --selfcheck      # 只跑 61 项离线自检，不启动服务
PORT=9000 ./run.sh        # 换端口
HOST=0.0.0.0 ./run.sh     # 允许外部访问（见下方安全提醒）
VENV=/tmp/v ./run.sh      # 换虚拟环境位置
```

## 三、手动启动（不用 run.sh）

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

export HARNESS_DB="$PWD/data/harness.db"
export HARNESS_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
export PYTHONPATH="$PWD/backend:$PWD/sdk"

# 可选：写演示数据
.venv/bin/python -c "from app import store, seed; store.init_db(); print(seed.seed())"

.venv/bin/python -m uvicorn app.api:app --host 127.0.0.1 --port 8848 --app-dir backend
```

## 四、环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HARNESS_DB` | `<项目>/data/harness.db` | SQLite 文件路径。**生产必须指到持久化磁盘** |
| `HARNESS_SECRET` | `agentloop-harness-dev-secret` | 会话签名 + 本地 Token 混淆密钥。⚠️ **生产必须改**，否则已签发会话在重启后仍有效且可被伪造 |
| `HARNESS_ENDPOINT` | `http://127.0.0.1:8848` | SDK 侧使用，平台地址 |
| `HARNESS_TOKEN` | 空 | SDK 侧使用，`hnx_` 开头的 API Token |
| `HARNESS_AGENT` | `ops-agent` | SDK 侧默认 Agent 名 |
| `HARNESS_AGENT_VERSION` | `v0.0.1` | SDK 侧默认 Agent 版本 |

> `HARNESS_SECRET` 的默认值是**开发用占位符**，源码里已如此注释。部署到任何非本机环境前，务必生成随机值并妥善保管——改这个值会让所有已签发会话失效（这是预期的安全行为）。

## 五、依赖安装踩坑记录

`pip install -r requirements.txt` 在部分网络环境下会**长时间无响应甚至被 OOM Killer 杀掉**（表现是 exit 137）。稳妥做法是先下载再离线安装：

```bash
mkdir -p /tmp/wheels
.venv/bin/pip download -r requirements.txt -d /tmp/wheels
.venv/bin/pip install --no-index --find-links /tmp/wheels -r requirements.txt
```

已验证可用的版本组合：

```
fastapi  0.141.1
uvicorn  0.53.0
httpx    0.28.1
pydantic 2.13.5
```

`requirements.txt` 用的是版本**区间**（`fastapi>=0.115` 等）而不是精确钉版，便于在新 Python 上取到可用版本。若你追求绝对可复现，把上面四个版本钉死即可。

## 六、验证安装

```bash
# 1) 离线自检（不需要 Web 框架，纯算法验证）
./run.sh --selfcheck          # 期望：35 passed, 0 failed

# 2) 端到端冒烟（需要服务在跑）
.venv/bin/python scripts/smoke_api.py   # 期望：29 passed, 0 failed
```

跑 `smoke_api.py` 前记得先起服务，并且**在同一个 shell 会话里**执行（后台进程不跨会话存活）：

```bash
export HARNESS_DB="$PWD/data/harness.db" PYTHONPATH="$PWD/backend:$PWD/sdk"
.venv/bin/python -m uvicorn app.api:app --host 127.0.0.1 --port 8848 --app-dir backend &
sleep 2
.venv/bin/python scripts/smoke_api.py
kill %1
```

## 七、SDK 安装与接入

```bash
# 从本仓库安装（推荐，永远与平台同版本）
pip install -e ./sdk

# 配置连接
harness login --endpoint http://127.0.0.1:8848 --token hnx_xxxxxxxx
harness status

# 三种上报方式
harness record  --task "跑诊断脚本" -- python3 my_agent.py
harness snapshot --dir ./snapshots --task "checkout P99 飙升" --error-type slowSQL
harness demo                                     # 内置演示场景，验证链路
```

Token 在网页「设置 → API Token」生成。SDK **零第三方依赖**（纯 `urllib`），可以直接丢进任何 Python 环境，包括 K8s Pod 里的 sidecar。

配置文件位于 `~/.agentloop-harness.json`。

## 八、GitHub 接入

在网页「设置」里填：

| 字段 | 示例 | 说明 |
|---|---|---|
| GitHub Token | `gho_xxx…` | 需要 `repo` 权限（私有仓库勾选 `repo`，公开仓库也建议 `repo`） |
| Owner | `tachikomaver2-ship-it` | 仓库属主 |
| Repo | `vibecoding` | 仓库名 |
| Base Branch | `main` | 从哪个分支拉出新分支 |

填完点「验证连通」——平台会调 GitHub API 拿你的登录名、仓库全名、默认分支、权限，确认无误再保存。

之后在「优化建议」页对某条建议点**确认 → 提交**，平台会：

1. 从 `Base Branch` 建分支 `harness/opt-<ID>-<时间戳>`
2. 提交目标文件（skill / prompt / 别名表）
3. 提交 `harness/optimizations/<slug>.md`（建议说明 + diff + 关联案例）
4. 提交 `harness/cases/<case_key>.json`（案例冻结快照）
5. 开 PR 到 `Base Branch`

**平台永远不会自动 push**，每次提交都需要你在网页上点确认。

## 九、生产部署建议

### 单机 + 反向代理

```nginx
server {
    listen 443 ssl http2;
    server_name harness.example.com;

    ssl_certificate     /etc/letsencrypt/live/harness.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/harness.example.com/privkey.pem;

    client_max_body_size 32m;   # 快照包可能较大

    location / {
        proxy_pass         http://127.0.0.1:8848;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # live 回放可能较慢
    }
}
```

### systemd 单元

```ini
[Unit]
Description=AgentLoop Harness
After=network.target

[Service]
Type=simple
User=harness
WorkingDirectory=/opt/agentloop-harness
Environment=HARNESS_DB=/var/lib/agentloop-harness/harness.db
Environment=HARNESS_SECRET=REPLACE_WITH_RANDOM_48_CHARS
Environment=PYTHONPATH=/opt/agentloop-harness/backend:/opt/agentloop-harness/sdk
ExecStart=/opt/agentloop-harness/.venv/bin/python -m uvicorn app.api:app \
          --host 127.0.0.1 --port 8848 --app-dir /opt/agentloop-harness/backend
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 部署检查清单

- [ ] `HARNESS_SECRET` 已改成随机值（**最容易漏的一条**）
- [ ] `HARNESS_DB` 指向持久化磁盘，且已加入备份计划
- [ ] 前面挂了 HTTPS 反向代理；**不要**把 uvicorn 直接暴露到公网
- [ ] `data/` 目录权限收紧（内含 Token 与全部案例）
- [ ] 已配置日志轮转（uvicorn access log）
- [ ] 演示账号 `admin/admin123` 已删除或改密（`--seed` 才会创建）
- [ ] 已按需调整 `pass_threshold`（默认 0.75）

## 十、备份与迁移

```bash
# 备份（SQLite WAL 模式下推荐用 .backup 保证一致性）
sqlite3 data/harness.db ".backup '/backup/harness-$(date +%F).db'"

# 迁移：整个平台的状态就是一个文件
scp data/harness.db newhost:/opt/agentloop-harness/data/
```

> 注意 `data/harness.db-wal` 和 `-shm` 是 WAL 模式的伴生文件。**热备份请用 `.backup` 命令**，不要直接 `cp` 主文件（可能丢掉 WAL 中未 checkpoint 的事务）。

## 十一、常见问题

**Q：`harness snapshot` 说"目录下没有匹配的文件"**
文件名必须匹配 `*.jsonl` 或 `*.json`，且**文件名的第一段决定模态**：`metrics.jsonl` → `metric`，`logs.jsonl` → `log`，`traces.jsonl` → `trace`。参考 `examples/snapshot/`。

**Q：连本地服务报 502 / ProxyError**
开发机上常有 Docker 或公司代理把 `127.0.0.1` 也拦截了。SDK 和 `smoke_api.py` 都已显式 `ProxyHandler({})` 绕过；如果你自己写脚本调 API，记得也绕过。

**Q：live 回放报"调用 Agent 端点失败"**
检查「设置 → 被测 Agent 地址」是否为完整 URL（含路径，例如 `http://127.0.0.1:8899/diagnose`），并确认该端点接受 `POST` + JSON、返回 `{"prediction": {...}}`。可先用 `python3 examples/local_agent.py` 起一个示例端点试通链路。

**Q：GitHub 提交时报 403**
Token 缺 `repo` 权限，或对私有仓库无写权限。用「验证连通」按钮能提前发现。

**Q：优化建议里的 diff 显示是"新建文件"而不是修改**
说明 `settings` 里还没有该文件的旧版本（`file:<path>` 键）。首次生成建议时平台读不到旧内容，只能按新建处理；第二次针对同一文件出建议时就会有正常的 diff。这属于预期行为。

**Q：前端页面某些区域空白**
先用 `node --check web/app.js` 确认语法无误，再看浏览器控制台。图表依赖 jsdelivr CDN 加载 ECharts——**完全离线环境需要把 ECharts 下载到 `web/vendor/` 并改 `index.html` 的引用**。
