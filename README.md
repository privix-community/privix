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
- **本地优先**:所有会话、配置、日志保存在本机,无云端强依赖

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

Privix Community 是从 Privix 商业版(闭源)拉出的独立开源仓库,**移除了所有商业专有功能**:
- 激活码 / 授权校验
- 投资工作台(Invest Workbench)、知识库、SOP 引擎
- ProspectResearch、Claw Swarm、Star Office 等增值模块
- 官网/自动更新等商业分发基础设施

保留并开源:上游 ClawPanel 同源的 OpenClaw 核心能力 + 我们自行开发的 Hermes 引擎集成 + Claw Doctor 独立助手。

## 贡献

欢迎 PR 与 Issue。

## 致谢

- [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) — MIT 开源的 OpenClaw 桌面管理面板
- [openclaw/openclaw](https://github.com/openclaw/openclaw) — OpenClaw AI Agent 框架
