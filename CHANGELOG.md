# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/) 风格 + [SemVer](https://semver.org/) 版本号。

`-ce.N` 后缀表示 Community Edition 的迭代号。

## [2.1.0-ce.1] - 2026-04-20

社区版差异化里程碑:引入 ProspectResearch 研究工作台与三项隐私功能,明确"**隐私优先的 AI 研究工作台**"定位。

### 新增

- **零遥测守卫 (`npm run check:telemetry`)**:扫描 `src/` / `src-tauri/src/` / `scripts/` 全部硬编码 URL,与 `scripts/telemetry-allowlist.txt`(98 条允许域名)比对,未登记即 fail。接入 pre-commit hook,CI 强制。README 新增"零遥测承诺"章节明确不做任何使用分析、错误上报、心跳、自动更新。
- **敏感信息检测脱敏 (`src/lib/sensitive-detect.js`)**:发送消息前自动扫描 Anthropic/OpenAI/Google API Key、JWT、PEM 私钥、中国身份证(GB 11643 checksum)、中国手机号、银行卡(Luhn 校验)。命中弹窗提供 [掩码发送 / 移除包含行 / 原文发送(需二次确认) / 取消] 四种动作。设置页"敏感信息检测"区块可按类型勾选。12 个单测覆盖检测 + 校验 + 索引处理。
- **ProspectResearch 研究工作台(`/research`)**:从商业版 EvoScientist 移植通用多轮研究 / 综述 / 引用追溯 flow,**剥离 PE/VC 行业 KB 依赖**(`task-case-templates.js`、行业 case 画廊、`pevc-kb` 相关代码)。ported 5 个 evoscientist-* lib + 页面 + CSS + doc-export + 401 个 i18n key(11 locales)。侧边栏新增主线图标。
- **Workspace 工作区隔离**:每个 workspace 拥有独立 localStorage 命名空间 `pcws.<id>.*`,默认工作区用裸键兼容现有用户数据。Sidebar 顶部新增 switcher 下拉菜单,支持切换 / 新建 / 重命名 / 删除(含数据清理)。13 个单测覆盖 CRUD + 跨 ws 隔离 + 全局键共享。

### 变更

- 版本号跃升到 `2.1.0-ce.1`(minor bump,表示功能新增)
- `package.json` 新增 `check:telemetry` script,并接入 `install-git-hooks.js` 生成的 pre-commit hook
- `src/main.js` 顶部最早 import `workspace-storage.js` 并 `installWorkspaceStorage()`,确保后续模块所有 localStorage 访问经过命名空间
- `src/components/sidebar.js` `getNavPillars()` 插入 ProspectResearch 主线;`ICONS` 新增 `research` compass 图标
- `UPSTREAM.md` 新增 "CE ↔ 商业版 ProspectResearch 同步表",指导以后商业版改动如何选择性 port
- ESLint 全局添加 `btoa` / `atob`(DOM Base64 API)

## [2.0.0-ce.2] - 2026-04-20

### Cleanup (audit D)
- Remove residual invest_workbench / evoscientist / doc_sop / local_qa_kb dead code across 30+ files
- Simplify quick-setup wizard from 4 steps to 2 steps (OpenClaw status + completion)
- Remove /api license backend (commercial authorization server)
- Fix deploy.sh URLs pointing to legacy repo

## [2.0.0-ce.1] — 2026-04-19

Privix Community 首个独立开源发行版。从 Privix 内部版本 v1.6.0-fix1 拉出,以 Apache-2.0 开源,与商业版彻底切断。

### 加入(相对于上游 ClawPanel v0.13.3 基线)

- **Hermes Agent 引擎集成**:双引擎架构,8 页面 + 25 个 Rust 命令,SSE 流式对话 + Python 集成
- **Claw Doctor(钳子医生)**:独立 AI 助手,支持 15+ 模型服务商、80+ 模型预设、多模态图文对话、工具调用、Agent 灵魂移植
- **多实例管理**:一个客户端管理多个 OpenClaw 实例
- **Apple Design 设计系统**:SF Pro 字体 + 980px 胶囊 CTA + navigation glass
- **消息渠道丰富**:Telegram / Discord / 飞书 / 钉钉 / QQ / 企业微信 / 微信 / Slack
- **版本特性门控**:按 OpenClaw 版本动态显隐功能

### 移除(相对于 Privix 商业版 v1.6.0-fix1)

- 激活码 / 授权系统(license-gate、Rust `license.rs`、product profile `licensePolicy`)
- Invest 工作台(20+ 页面:pool、pipeline、companies、contacts、deal、scoring、audit、automation、invest-dashboard、invest-docs 等)
- Knowledge Wiki 模块(Karpathy 式知识库:kb-wiki-ingest/prompts/query、`kb_wiki.rs`)
- SOP 引擎(DAG 依赖、执行监督、模式归纳)
- ProspectResearch / EvoScientist 科研智能体(`evoscientist.rs` + Python bridge)
- ClawSwarm 多 Agent 蜂群编排(7 libs + `swarm_chat_complete` 命令)
- Star Office / 像素宠物工作台游戏化
- 自动更新检查(`check_frontend_update` 等 4 个命令、检查器循环)
- 官网 portal、`release-to-portal.sh`、Vercel CDN 分发、`privix.cn` phone-home
- Extension 命令(cftunnel / ClawApp)

### 许可证

- **本项目整体**:Apache License 2.0
- **上游 ClawPanel 衍生代码**:保留 MIT 原许可
- 详见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)
