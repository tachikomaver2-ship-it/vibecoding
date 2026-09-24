# launchd 模板（可选：开机自启）

`daemonctl.sh` 的守护进程在**用户登录期间**常驻且崩溃自动重启，但**重启电脑后不会自动拉起**。想要开机自启，用这里的 launchd 模板（二选一，不要和 daemonctl 同时跑，会抢端口）。

## 启用步骤（在你自己的终端里执行）

```bash
cd <本项目根目录>/scripts/launchd

# 1. 把模板里的路径占位符替换成本机实际路径
sed -i '' "s|__HARNESS_ROOT__|$(cd ../.. && pwd)|g" com.agentloop.harness.server.plist com.agentloop.harness.tunnel.plist

# 2. 先停掉 daemonctl 方式起的进程，避免冲突
../../scripts/daemonctl.sh stop

# 3. 注册（macOS 13+；旧系统用 launchctl load -w <plist>）
launchctl bootstrap gui/$(id -u) com.agentloop.harness.server.plist
launchctl bootstrap gui/$(id -u) com.agentloop.harness.tunnel.plist
```

## 语义

| 配置 | 值 | 说明 |
|---|---|---|
| `RunAtLoad` | true | 登录即启动 |
| `KeepAlive` | true | 崩溃自动重启（等价 daemonctl 的 supervise.sh） |
| `ThrottleInterval` | 5/10 秒 | 重启间隔，防止疯狂拉起 |

## 管理

```bash
launchctl print gui/$(id -u)/com.agentloop.harness.server   # 查看状态
launchctl bootout gui/$(id -u)/com.agentloop.harness.server  # 停止并注销
```

服务日志仍在 `data/server.log`、`data/tunnel.log`（脚本自己重定向），
launchd 的 stdout/stderr 兜底在 `data/*.stdout.log`。

## 已知问题

- 从某些受管进程（IDE 内嵌终端、远程会话）里执行 `launchctl bootstrap`
  可能报 `Bootstrap failed: 5: Input/output error` —— 换到用户正常登录的
  Terminal.app / iTerm 里执行即可。
