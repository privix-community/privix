# Privix Community 用户手册

适用版本: `2.0.0-ce.1` 起

---

## 目录

1. [安装](#安装)
2. [首次启动](#首次启动)
3. [三大核心能力](#三大核心能力)
4. [AI Provider 配置](#ai-provider-配置)
5. [引擎模式切换](#引擎模式切换)
6. [数据存储位置](#数据存储位置)
7. [故障排查](#故障排查)
8. [升级与迁移](#升级与迁移)
9. [常见问题](#常见问题)

---

## 安装

### 方式 A:下载预编译包(推荐)

前往 [GitHub Releases](https://github.com/privix-community/privix/releases) 下载对应平台的包:

| 平台 | 产物 |
|------|------|
| macOS (Apple Silicon / Intel) | `Privix_X.Y.Z_aarch64.dmg` / `Privix_X.Y.Z_x64.dmg` |
| Linux (x64) | `privix_X.Y.Z_amd64.deb` / `.AppImage` |
| Windows (x64) | `Privix_X.Y.Z_x64-setup.exe` |

macOS 首次打开可能被 Gatekeeper 拦截,右键 → 打开,或执行:

```bash
xattr -cr /Applications/Privix.app
```

### 方式 B:从源码构建

前置:Node.js 18+、Rust 1.77+、平台 C 工具链(macOS: Xcode CLT;Windows: MSVC;Linux: webkit2gtk-4.1-dev)。

```bash
git clone https://github.com/privix-community/privix.git
cd privix
npm install
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/` 下。开发模式用 `npm run tauri dev`。

### Web 模式(无 Tauri 编译环境)

浏览器直接访问,通过 `scripts/dev-api.js` 提供 Node 端 API:

```bash
npm install
npm run dev
# 访问 http://localhost:5173
```

功能略有裁剪(无系统托盘、文件对话框走浏览器原生)。

---

## 首次启动

### 一键配置(`/quick-setup`)

首次启动自动进入一键配置向导,共 2 步:

**Step 1 — OpenClaw 状态检测**

OpenClaw 是 Agent 运行时后端,由独立的 Node CLI (`@qingchencloud/openclaw-zh`) 提供。

- 已检测到 → 直接点"继续"
- 未检测到 → 点"前往安装向导"进入 `/setup`,按提示安装 Node + OpenClaw CLI

**Step 2 — 完成**

确认 OpenClaw 已就绪后,点"进入工作台"跳到默认主页。

> **跳过向导**:如果你已经熟悉环境,可直接访问 `/dashboard`、`/assistant` 等路由。

### OpenClaw 安装向导(`/setup`)

一键安装 OpenClaw CLI(根据平台自动选择 npm / 打包二进制)。需要一次性的管理员权限(npm global 安装)。

---

## 三大核心能力

Privix Community 提供 3 个互补模块,可混合使用:

### 1. OpenClaw 管理面板(默认)

- `/dashboard` — 总览(健康状态、最近会话、快捷入口)
- `/chat` — 多会话对话界面
- `/models` — 模型与 Provider 配置
- `/agents` — Agent 定义与启动
- `/memory` — 长期记忆浏览
- `/mcp` — MCP Server 注册
- `/channels` — 消息渠道(Slack / Discord / Webhook)

### 2. Hermes 引擎(轻量 Agent)

Hermes 是 Privix 自研的轻量 Agent 引擎,**内置不需额外安装**。启用方式见 [引擎模式切换](#引擎模式切换)。

侧栏收敛为:Hermes 折叠组 + 钳子医生 + 一键配置 + 系统设置。

### 3. Claw Doctor / 钳子医生(`/assistant`)

独立 AI 助手,与 OpenClaw / Hermes 解耦,可直连任何 Provider。支持:

- 多轮对话 + Markdown 渲染
- 工具调用(文件读写、Shell 命令,需系统权限)
- 记忆(可选)
- 跨会话搜索

适合快速问答、代码解释、日志诊断。

---

## AI Provider 配置

OpenClaw 与 Claw Doctor 共用 Provider 列表(位于 `/models` 和 `/assistant` 的设置面板)。

### 支持的 Provider

- **Anthropic** — Claude 系列
- **OpenAI** — GPT 系列
- **Google** — Gemini 系列
- **DeepSeek / Kimi / 通义 / 智谱 / MiniMax** — 国内主流
- **Ollama / LM Studio** — 本地模型(http://localhost:11434 等)
- **OpenAI 兼容** — 任意自建网关(vLLM / LocalAI / LiteLLM)

### 添加步骤

1. 打开 `/models`(或 `/assistant` 右上齿轮)
2. 点"添加 Provider"
3. 选类型 → 填 API Key / Base URL → 保存
4. 测试联通:新建一个 chat,发一条消息

**API Key 本地存储**(LocalStorage + 可选磁盘加密),**不会**上传到任何远端服务。

---

## 引擎模式切换

Privix 支持两种运行时引擎,由"引擎路由策略"控制:

| 引擎 | 特点 | 适用场景 |
|------|------|---------|
| **OpenClaw** | 完整面板,多模块,配置丰富 | 日常主力,Agent 工作流 |
| **Hermes** | 轻量,Vanilla JS 内嵌,零额外依赖 | 快速测试,无 Node / CLI 时的回退 |

### 切换

设置 → 系统 → 引擎路由 → 选择 `OpenClaw` 或 `Hermes`,刷新。

> Hermes 模式下,OpenClaw 独有路由(agents / mcp / channels 等)不可用;`/chat` 和 `/assistant` 仍然可用。

---

## 数据存储位置

所有数据**100% 本地**,不依赖任何云端:

| 类型 | 路径 |
|------|------|
| 面板配置 | `~/.openclaw/privix-community/<profileId>/clawpanel.json` |
| OpenClaw 核心配置 | `~/.openclaw/openclaw.json` |
| MCP 注册 | `~/.openclaw/mcp.json` |
| 日志 | `~/.openclaw/logs/` |
| 备份 | `~/.openclaw/backups/` |
| Claw Doctor 会话 | LocalStorage(桌面模式)/ 磁盘(由助手设置控制) |

### 手动备份

```bash
cp -r ~/.openclaw ~/.openclaw.bak-$(date +%Y%m%d)
```

### 完全重置

> ⚠️ 会丢失全部会话、Agent、Provider 配置。

```bash
# macOS / Linux
rm -rf ~/.openclaw
# 重启 Privix 即回到首次启动状态
```

---

## 故障排查

### 打不开 / 启动崩溃

1. 尝试 `/diagnose` 页(如能打开)— 自动收集系统信息
2. 手动查看日志: `~/.openclaw/logs/panel.log`
3. macOS: `Console.app` 搜索 "Privix"
4. Linux: `journalctl --user -u privix-community -f`

### OpenClaw CLI not found

PATH 里缺 `openclaw` 可执行文件。确认:

```bash
which openclaw
openclaw --version
```

Tauri 打包后的 app 继承桌面环境的 PATH,通常需要 `openclaw` 在 `/usr/local/bin` 或 `$HOME/.npm-global/bin`。如用 nvm,可能需要手动建软链:

```bash
sudo ln -s "$(which openclaw)" /usr/local/bin/openclaw
```

### 模型调用失败

按顺序检查:

1. API Key 是否填对(Provider 设置页有"测试联通"按钮)
2. Base URL 末尾**不要**加 `/`(除非特定 Provider 要求)
3. 网络:国内环境访问 OpenAI / Anthropic / Google 需自行解决出站
4. 用 `/chat-debug` 查看原始请求 / 响应

### 侧边栏入口消失

通常是引擎模式切到 Hermes 导致的路由收敛。到 `/settings → 引擎路由`切回 OpenClaw。

### 无法连接 Ollama

默认 Ollama `http://localhost:11434`。桌面 app 走 `http://127.0.0.1:11434` 更稳(某些系统 `localhost` 解析走 IPv6 而 Ollama 只听 v4)。

---

## 升级与迁移

### 从旧版本升级

启动时会自动检查目录:`~/.openclaw/prospectclaw/` 若存在且 `~/.openclaw/privix-community/` 不存在,会被**原子 rename** 到新路径。日志见 `stderr`:

```
[migration] renamed /Users/xxx/.openclaw/prospectclaw -> /Users/xxx/.openclaw/privix-community
```

若迁移失败(如权限问题),不会阻塞启动,应用会用空配置启动。手动修复:

```bash
mv ~/.openclaw/prospectclaw ~/.openclaw/privix-community
```

### 手动检查更新

顶栏或 `/dashboard` 右上角"检查更新"按钮(手动触发,不做后台轮询)会打 `api.github.com/repos/privix-community/privix/releases/latest`,有新版时提示下载链接。不会自动下载或安装。

### 降级 / 回滚

1. 备份 `~/.openclaw`
2. 卸载当前版本(macOS: 拖到废纸篓;Linux: `apt remove privix-community`;Windows: 控制面板)
3. 从 Releases 下载旧版本包重装
4. 恢复 `~/.openclaw` 备份

---

## 常见问题

**Q: Privix Community 和商业版 Privix 是什么关系?**
A: 社区版是从商业版 fork 的独立开源分支,移除了激活码、授权校验、投资工作台、知识库 SOP 等商业模块。保留并开源:OpenClaw 核心面板 + Hermes 引擎 + Claw Doctor。Apache-2.0 许可证。

**Q: 需要付费吗?**
A: **完全免费**,无订阅、无激活码、无额度限制。你只需自备模型 Provider 的 API Key(或用本地 Ollama 零成本)。

**Q: 我的对话 / 文件会被上传到 Privix 服务器吗?**
A: 不会。Privix Community 没有任何官网 CDN 或 telemetry。所有数据本地存储,所有模型调用从你的机器直连 Provider。

**Q: 能在企业内网 / 离线环境跑吗?**
A: 可以。核心功能不依赖外网。只要你的 Provider(如内网部署的 Ollama / vLLM)在 LAN 可达即可。

**Q: 可以二次分发吗?**
A: Apache-2.0 允许闭源二次分发,需保留 LICENSE + NOTICE。详见仓库根 [LICENSE](../LICENSE) 和 [NOTICE](../NOTICE)。

**Q: 在哪里提 Issue / PR?**
A: [github.com/privix-community/privix/issues](https://github.com/privix-community/privix/issues)。安全漏洞请按 [SECURITY.md](../SECURITY.md) 私有报告流程。

**Q: 多人 / 多设备共享配置?**
A: 社区版定位单机。多设备可手动 `scp` 或用 git 管理 `~/.openclaw/` 目录(注意脱敏 API Key)。
