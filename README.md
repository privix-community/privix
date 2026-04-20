<p align="center">
  <img src="public/images/privix-mark.svg" width="360" alt="Privix Community">
</p>

<p align="center">
  <strong>Privix Community</strong> — 开源 AI Agent 桌面工作台
</p>

<p align="center">
  OpenClaw + Hermes 双引擎 · 数据本地存储 · 直连模型 Provider
</p>

---

## 简介

Privix Community 是一个开源、免费、无鉴权的 AI Agent 桌面工作台,基于 Tauri v2 + Vite 构建,支持 macOS、Linux、Windows。

本仓库是 Privix 商业版的社区开源分支,遵循上游 [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) MIT 精神,将基础面板能力回馈社区。

### 核心能力

- **OpenClaw 引擎**:仪表盘、实时聊天、模型配置、Agent 管理、消息渠道、Skills、MCP 协议支持
- **Hermes 引擎**:轻量 Agent 引擎,一键启动、开箱即用
- **Claw Doctor(钳子医生)**:独立 AI 助手,支持多 Provider 配置(Anthropic / OpenAI / Google / 国内主流厂商)
- **ProspectResearch(研究工作台)**:多轮搜索 / 综述 / 引用追溯工作流,导出 DOCX / PPTX / HTML
- **隐私优先**:零遥测承诺 · 敏感信息检测脱敏 · 多工作区隔离 · 所有会话本地存储

## 零遥测承诺 / Zero Telemetry Pledge

Privix Community 不收集任何遥测、分析、错误上报、用户追踪数据:

- **没有匿名 ID / 设备指纹**:启动时不发任何标识性请求
- **没有使用统计**:功能点击、页面访问、会话元数据从不上报
- **没有错误收集**:崩溃 / 异常信息只在本地日志
- **没有自动更新**:应用不主动联网检查新版本(手动 `git pull` 或关注 Release)
- **没有许可验证**:无激活码、在线授权、心跳

**唯一外联流量**:你主动配置的模型提供商 API(Anthropic / OpenAI / DeepSeek 等)、频道 webhook(Telegram / Discord / 飞书等)、Agent 工具(搜索 / 抓取)。

### 如何自行验证

1. **源码层守卫**:`npm run check:telemetry` 扫描仓库所有硬编码 URL,不在 [allowlist](./scripts/telemetry-allowlist.txt) 即失败,pre-commit 强制执行
2. **网络层验证**:启动应用后 `lsof -i -p <PID>` 在空闲态应无任何连接;仅在你主动聊天 / 调工具时才会有流量
3. **代码审计**:所有外联请求集中于 `src/lib/tauri-api.js` 与 `src-tauri/src/commands/`,便于逐条审查

发现违规请开 [issue](https://github.com/privix-community/privix/issues) 或 PR。

## 快速开始

```bash
# 克隆
git clone https://github.com/privix-community/privix.git
cd privix

# 安装依赖
npm install

# 开发模式(桌面)
npm run tauri dev

# 开发模式(Web)
npm run dev

# 打包(需 Rust + Xcode/MSVC 工具链)
npm run tauri build
```

首次启动会进入 `/setup` 向导:
1. 检测 Node.js / OpenClaw CLI 是否就绪
2. 配置至少一个 AI Provider(推荐 DeepSeek / Kimi / Moonshot / 通义)
3. 完成后进入 `/overview` 工作台

## 文档

- [用户手册](./docs/USER_GUIDE.md) — 安装、首次启动、Provider 配置、故障排查、FAQ
- [上游同步策略](./UPSTREAM.md)
- [贡献指南](./CONTRIBUTING.md)
- [安全策略](./SECURITY.md)

## 许可证

- **本项目整体**:[Apache License 2.0](./LICENSE)
- **上游 ClawPanel 衍生代码**:保留 [MIT License](./LICENSE) 原声明
- 详见 [NOTICE](./NOTICE)

## 与商业版的关系

Privix Community 是从 Privix 商业版(闭源)拉出的独立开源仓库。定位为**隐私优先的 AI 研究工作台**,面向研究者、个人开发者和隐私敏感用户。

商业版(Privix)与社区版(Privix Community)功能对比:

| 能力 | Privix Community | Privix 商业版 |
|---|---|---|
| OpenClaw 核心(聊天/模型/Agent/记忆/频道/Skills/MCP) | ✅ | ✅ |
| Hermes 轻量引擎 | ✅ | ✅ |
| Claw Doctor 独立助手 | ✅ | ✅ |
| ProspectResearch 研究工作台 | ✅ 通用版(研究/综述/引用) | ✅ 完整版 + PE/VC 行业 KB |
| 零遥测守卫 + 敏感信息脱敏 + Workspace 隔离 | ✅ | — |
| 投资工作台(Invest)· 企业 KB · SOP 引擎 | — | ✅ |
| Claw Swarm · Star Office | — | ✅ |
| 激活码 / 授权校验 / 自动更新 | — | ✅ |

保留并开源:上游 ClawPanel 同源的 OpenClaw 核心 + Hermes 引擎集成 + Claw Doctor + ProspectResearch 通用研究 flow + 三项隐私功能。

## 贡献

欢迎 PR 与 Issue。

## 致谢

- [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) — MIT 开源的 OpenClaw 桌面管理面板
- [openclaw/openclaw](https://github.com/openclaw/openclaw) — OpenClaw AI Agent 框架
