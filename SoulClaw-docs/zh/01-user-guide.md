# MinGate 用户指南

> MinGate — 极简 AI 助理网关，支持飞书与 Telegram

---

## 目录

1. [项目简介](#1-项目简介)
2. [快速开始](#2-快速开始)
3. [目录结构](#3-目录结构)
4. [配置详解](#4-配置详解)
   - 4.1 [数据目录](#41-数据目录)
   - 4.2 [config.json](#42-configjson)
   - 4.3 [.env 环境变量](#43-env-环境变量)
   - 4.4 [soul.md 系统提示词](#44-soulmd-系统提示词)
5. [渠道接入](#5-渠道接入)
   - 5.1 [Telegram 接入](#51-telegram-接入)
   - 5.2 [飞书接入](#52-飞书接入)
6. [用户配对（Pairing）](#6-用户配对pairing)
7. [CLI 命令行工具](#7-cli-命令行工具)
8. [记忆系统](#8-记忆系统)
9. [Web 控制台](#9-web-控制台)
10. [定时任务（Cron）](#10-定时任务cron)
11. [Docker 部署](#11-docker-部署)
12. [安全说明](#12-安全说明)
13. [故障排查](#13-故障排查)

---

## 1. 项目简介

MinGate 是一个**极简 AI 助理网关**，专为个人或小团队设计。它以 Node.js 服务的形式运行，连接飞书（Feishu）或 Telegram，调用 Anthropic（Claude）或 OpenAI 的模型来响应消息。

### 核心特性

| 特性 | 说明 |
|------|------|
| 多渠道支持 | 同时支持飞书和 Telegram |
| 多模型支持 | 支持 Anthropic（Claude）和 OpenAI 模型 |
| 三层记忆模型 | 工作记忆 / 短期记忆 / 长期记忆，自动管理 |
| Web 控制台 | 内置单页面控制台，可查看对话、记忆、定时任务 |
| CLI 工具 | 命令行管理用户配对、会话、定时任务 |
| 定时任务 | 内置 Cron 支持，按计划向指定用户发送消息 |
| 极简配置 | 一个 JSON 配置文件 + 一个 .env 文件即可启动 |

### 设计定位

MinGate 不是面向企业的复杂平台，而是一个**够用就好**的轻量工具：

- 适合个人开发者或小团队自托管
- 配置文件可读性强，无复杂数据库依赖（记忆以 Markdown 文件存储）
- 系统提示词（`soul.md`）完全由用户掌控，模型不会看到任何隐藏指令

---

## 2. 快速开始

本节提供从零到可用的最短路径，适合希望快速体验 MinGate 的读者。详细说明请参阅后续各节。

### 前置条件

- Node.js >= 22
- 一个 Telegram Bot Token 或飞书应用凭证
- 一个 Anthropic 或 OpenAI 的 API Key

### 步骤一：安装依赖并构建

```bash
# 进入项目目录
cd /path/to/mingate

# 安装依赖
npm install

# 构建（生产模式）
npm run build
```

### 步骤二：创建数据目录与配置文件

MinGate 默认使用 `~/.mingate/` 作为数据目录。

```bash
mkdir -p ~/.mingate
```

在数据目录下创建 `.env` 文件（存放敏感凭证）：

```bash
cat > ~/.mingate/.env << 'EOF'
MINGATE_TOKEN=your-gateway-token
TELEGRAM_BOT_TOKEN=1234567890:ABCxxx
TELEGRAM_PUBLIC_URL=https://your-domain.com
MODEL_API_KEY=sk-ant-xxx
EOF
```

> `.env` 文件永远不要提交到 Git！

在项目根目录创建 `config.json`（或复制示例）：

```json
{
  "port": 3000,
  "telegram": {
    "allowFrom": ["+8613800000000"],
    "webhookPath": "/telegram/webhook"
  },
  "model": {
    "provider": "anthropic",
    "model": "claude-opus-4-6",
    "maxTokens": 4096,
    "thinking": false,
    "temperature": 1.0
  },
  "memory": {
    "enabled": true,
    "shortTermDays": 14,
    "consolidateIdleMinutes": 30
  },
  "addChannelContext": true
}
```

### 步骤三：（可选）编写 soul.md

```bash
cat > ~/.mingate/soul.md << 'EOF'
你是 Alex，我的私人助理。
风格：直接、不废话、偶尔幽默。
不要解释你是 AI。
EOF
```

### 步骤四：启动

```bash
# 生产模式
npm start

# 或开发模式（无需构建，使用 ts-node）
npm run dev
```

启动成功后，打开浏览器访问 `http://localhost:3000` 即可看到 Web 控制台。

---

## 3. 目录结构

```
MinGate/
├── package.json
├── tsconfig.json
├── ui/
│   └── index.html          # Web 控制台（单一 HTML 文件）
└── src/
    ├── main.ts             # 入口点
    ├── cli.ts              # CLI 工具
    ├── config.ts           # 配置加载
    ├── logger.ts           # 日志
    ├── types.ts            # 类型定义
    ├── gateway/
    │   ├── server.ts       # HTTP + WebSocket 服务器
    │   └── auth.ts         # Token 鉴权 + 速率限制
    ├── channels/
    │   ├── telegram.ts     # Telegram 渠道实现
    │   └── feishu.ts       # 飞书渠道实现
    ├── agent/
    │   ├── runner.ts       # 模型调用 + 工具循环 + 流式输出
    │   ├── context.ts      # 上下文裁剪
    │   └── tools/
    │       ├── memory.ts           # 记忆工具（memory_search / memory_save）
    │       └── send_message.ts     # 消息发送工具
    ├── memory/
    │   ├── store.ts        # 记忆读写
    │   ├── search.ts       # 记忆检索
    │   ├── consolidate.ts  # 记忆整合（空闲触发）
    │   └── weekly.ts       # 每周短期→长期升级
    ├── session/
    │   ├── store.ts        # 会话存储
    │   └── routing.ts      # 消息路由
    ├── security/
    │   ├── allowlist.ts    # 用户白名单
    │   └── pairing.ts      # 配对码生成与验证
    └── cron/
        └── service.ts      # 定时任务调度
```

数据目录（默认 `~/.mingate/`）的运行时结构：

```
~/.mingate/
├── config.json             # 主配置（可提交 Git）
├── .env                    # 敏感凭证（禁止提交 Git）
├── soul.md                 # 系统提示词（可选）
└── memory/
    ├── short_term/
    │   ├── 2026-03-28.md
    │   └── 2026-03-29.md
    └── long_term/
        ├── facts.md
        ├── preferences.md
        └── projects/
            └── my-project.md
```

---

## 4. 配置详解

### 4.1 数据目录

MinGate 在启动时会读取数据目录中的 `config.json` 和 `.env`。

| 平台 | 默认路径 |
|------|---------|
| Linux / macOS | `~/.mingate/` |
| Windows | `C:\Users\<username>\.mingate\` |

**自定义数据目录：**

```bash
MINGATE_DATA_DIR=/path/to/data npm start
```

### 4.2 config.json

`config.json` 存放所有非敏感配置，可以安全地提交到 Git。

完整示例：

```json
{
  "port": 3000,
  "telegram": {
    "allowFrom": ["+8613800000000"],
    "webhookPath": "/telegram/webhook"
  },
  "feishu": {
    "appId": "cli_xxx",
    "allowFrom": ["ou_xxx"],
    "webhookPath": "/feishu/events"
  },
  "model": {
    "provider": "anthropic",
    "model": "claude-opus-4-6",
    "maxTokens": 4096,
    "thinking": false,
    "temperature": 1.0
  },
  "memory": {
    "enabled": true,
    "shortTermDays": 14,
    "consolidateIdleMinutes": 30
  },
  "cron": {
    "jobs": [
      {
        "id": "morning-brief",
        "schedule": "0 8 * * 1-5",
        "prompt": "给我发一个今天的日程提醒",
        "deliverTo": { "channel": "telegram", "peerId": "+8613800000000" },
        "tz": "Asia/Shanghai",
        "enabled": true
      }
    ]
  },
  "addChannelContext": true
}
```

#### 字段说明

**顶层字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| `port` | number | HTTP 服务监听端口，默认 `3000` |
| `addChannelContext` | boolean | 是否在每次对话中自动附加渠道来源信息（如"来自 Telegram"），默认 `true` |

**`telegram` 对象**

| 字段 | 类型 | 说明 |
|------|------|------|
| `allowFrom` | string[] | 允许发消息的手机号或用户 ID 列表；填 `["*"]` 表示允许所有人（仅开发用） |
| `webhookPath` | string | Telegram Webhook 路径，默认 `/telegram/webhook` |

**`feishu` 对象**

| 字段 | 类型 | 说明 |
|------|------|------|
| `appId` | string | 飞书应用的 App ID |
| `allowFrom` | string[] | 允许发消息的用户 open_id 列表；填 `["*"]` 表示允许所有人（仅开发用） |
| `webhookPath` | string | 飞书事件回调路径，默认 `/feishu/events` |

**`model` 对象**

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | string | 模型提供商，`"anthropic"` 或 `"openai"` |
| `model` | string | 模型名称，如 `"claude-opus-4-6"` |
| `maxTokens` | number | 单次响应最大 Token 数 |
| `thinking` | boolean | 是否启用思考模式（仅部分 Claude 模型支持） |
| `temperature` | number | 采样温度，范围 0.0–1.0 |

**`memory` 对象**

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用记忆系统 |
| `shortTermDays` | number | 短期记忆保留天数，超期自动删除，默认 `14` |
| `consolidateIdleMinutes` | number | 空闲多少分钟后触发记忆整合，默认 `30` |

**`cron.jobs` 数组**（每个任务的字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 任务唯一标识 |
| `schedule` | string | 标准 Cron 表达式（分 时 日 月 周） |
| `prompt` | string | 触发时发送给模型的提示词 |
| `deliverTo.channel` | string | 投递渠道，`"telegram"` 或 `"feishu"` |
| `deliverTo.peerId` | string | 投递目标：Telegram 填手机号，飞书填 open_id |
| `tz` | string | 时区，默认 `"UTC"`，推荐设为 `"Asia/Shanghai"` |
| `enabled` | boolean | 是否启用此任务 |

### 4.3 .env 环境变量

`.env` 文件存放所有敏感凭证，**永远不要提交到 Git**。

```dotenv
# Web 控制台鉴权 Token（强烈建议在生产环境设置）
MINGATE_TOKEN=your-gateway-token

# Telegram Bot Token（来自 @BotFather）
TELEGRAM_BOT_TOKEN=1234567890:ABCxxx

# 服务器公网 HTTPS 地址（用于注册 Telegram Webhook）
TELEGRAM_PUBLIC_URL=https://your-domain.com

# 飞书应用密钥
FEISHU_APP_SECRET=xxx

# 飞书事件验证 Token
FEISHU_VERIFICATION_TOKEN=xxx

# 模型 API Key（Anthropic 或 OpenAI）
MODEL_API_KEY=sk-ant-xxx
```

**各字段说明：**

| 变量 | 是否必填 | 说明 |
|------|---------|------|
| `MINGATE_TOKEN` | 强烈建议 | Web 控制台访问密码；未设置则控制台对所有人开放 |
| `TELEGRAM_BOT_TOKEN` | Telegram 必填 | 从 @BotFather 获取 |
| `TELEGRAM_PUBLIC_URL` | Telegram Webhook 必填 | 公网 HTTPS 地址；无公网 URL 时可省略（自动降级为长轮询，仅开发用） |
| `FEISHU_APP_SECRET` | 飞书必填 | 飞书应用后台获取 |
| `FEISHU_VERIFICATION_TOKEN` | 飞书必填 | 飞书事件订阅验证 Token |
| `MODEL_API_KEY` | 必填 | Anthropic 或 OpenAI 的 API Key |
| `MINGATE_DATA_DIR` | 可选 | 覆盖默认数据目录路径 |

### 4.4 soul.md 系统提示词

`soul.md` 是 MinGate 中**唯一的系统提示词**。模型看到的系统提示就是这个文件的完整内容，没有任何隐藏指令。

**位置：** `~/.mingate/soul.md`

**示例：**

```markdown
你是 Alex，我的私人助理。
风格：直接、不废话、偶尔幽默。
不要解释你是 AI。
```

**行为说明：**

- 若 `soul.md` 不存在，则模型无系统提示
- 若 `addChannelContext: true`，系统会在提示词末尾自动追加一行渠道来源信息（如 `[来自 Telegram]`）
- 可以在 `soul.md` 中自由定义助理的人格、语气、能力边界

---

## 5. 渠道接入

### 5.1 Telegram 接入

#### 步骤一：创建 Bot

1. 在 Telegram 中找到 **@BotFather**
2. 发送 `/newbot`，按提示设置 Bot 名称和用户名
3. 获取 `Bot Token`（格式：`1234567890:ABCxxx`）
4. 将 Token 写入 `.env`：

```dotenv
TELEGRAM_BOT_TOKEN=1234567890:ABCxxx
```

#### 步骤二：配置公网 URL（Webhook 模式）

如果服务器有公网 HTTPS 地址，MinGate 会自动使用 Webhook 模式（推荐生产环境使用）：

```dotenv
TELEGRAM_PUBLIC_URL=https://your-domain.com
```

MinGate 启动时会自动向 Telegram 注册 Webhook，路径为 `config.json` 中的 `telegram.webhookPath`（默认 `/telegram/webhook`）。

> 若未设置 `TELEGRAM_PUBLIC_URL`，MinGate 自动降级为**长轮询（long-polling）**模式，适合本地开发，不推荐生产使用。

#### 步骤三：配置白名单

在 `config.json` 中添加允许发消息的手机号或用户 ID：

```json
"telegram": {
  "allowFrom": ["+8613800000000", "+8613900000000"],
  "webhookPath": "/telegram/webhook"
}
```

- 手机号须包含国家代码（如 `+86`）
- 也可以填 Telegram 数字用户 ID
- 仅开发/测试时可填 `["*"]` 跳过验证

#### Telegram 安全验证

MinGate 通过 `X-Telegram-Bot-Api-Secret-Token` 请求头验证每个 Webhook 请求的真实性，防止伪造请求。

---

### 5.2 飞书接入

#### 步骤一：创建飞书应用

1. 访问 [open.feishu.cn](https://open.feishu.cn) 并登录
2. 点击"创建企业自建应用"
3. 记录 **App ID** 和 **App Secret**
4. 将 App Secret 写入 `.env`：

```dotenv
FEISHU_APP_SECRET=xxx
```

#### 步骤二：开启消息权限

在应用后台，进入"权限管理"，搜索并开启：

- `im:message:receive_v1`（接收消息）

完成后发布应用版本。

#### 步骤三：配置事件订阅

1. 在应用后台进入"事件订阅"
2. 设置请求地址（Request URL）为：

```
https://your-domain.com/feishu/events
```

3. 获取**验证 Token**，写入 `.env`：

```dotenv
FEISHU_VERIFICATION_TOKEN=xxx
```

#### 步骤四：配置白名单

获取需要授权用户的 `open_id`（格式：`ou_xxx`），添加到 `config.json`：

```json
"feishu": {
  "appId": "cli_xxx",
  "allowFrom": ["ou_xxxxxxxxxx"],
  "webhookPath": "/feishu/events"
}
```

#### 飞书安全验证

MinGate 使用 **SHA-256 HMAC 签名**验证每个飞书事件请求，防止伪造。

---

## 6. 用户配对（Pairing）

配对机制允许新用户无需管理员手动编辑配置文件就能申请接入 MinGate。

### 流程说明

```
新用户发送消息
      ↓
MinGate 检测到未授权用户
      ↓
自动生成 8 位配对码，回复给用户
      ↓
用户将配对码告知管理员
      ↓
管理员运行 CLI 命令批准
      ↓
用户被加入 allowFrom 白名单
      ↓
重启 MinGate 生效
```

### 管理员操作

```bash
# 开发模式（无需构建）
npx ts-node src/cli.ts allow <CODE>

# 生产模式（已构建）
node dist/cli.js allow <CODE>
```

将 `<CODE>` 替换为用户收到的 8 位配对码，例如：

```bash
node dist/cli.js allow A1B2C3D4
```

批准后，配对码对应的用户 open_id / 手机号会被自动追加到 `config.json` 的 `allowFrom` 中。

### 注意事项

- 配对码有效期为 **1 小时**，过期后用户需要重新发送消息以获取新码
- 批准后须**重启 MinGate** 才能使白名单变更生效
- 配对码由 MinGate 自动生成，管理员无需手动分配

---

## 7. CLI 命令行工具

MinGate 提供命令行工具用于日常管理操作。

### 使用方式

```bash
# 开发模式
npx ts-node src/cli.ts <command>

# 生产模式（构建后）
node dist/cli.js <command>
```

### 命令列表

| 命令 | 说明 |
|------|------|
| `mingate allow <code>` | 批准一个用户配对码，将用户加入白名单 |
| `mingate list` | 列出当前所有活跃会话 |
| `mingate jobs` | 列出所有定时任务及其状态 |
| `mingate version` | 打印 MinGate 版本信息 |

### 命令详解

**`allow <code>` — 批准配对码**

```bash
node dist/cli.js allow A1B2C3D4
```

将对应用户加入 `config.json` 的 `allowFrom` 白名单。操作后需重启服务生效。

**`list` — 查看活跃会话**

```bash
node dist/cli.js list
```

输出示例：

```
SESSION ID        CHANNEL    PEER                   LAST ACTIVE
sess_abc123       telegram   +8613800000000         2 min ago
sess_def456       feishu     ou_xxxxxxxxxx          15 min ago
```

**`jobs` — 查看定时任务**

```bash
node dist/cli.js jobs
```

输出示例：

```
ID               SCHEDULE        TZ              ENABLED   NEXT RUN
morning-brief    0 8 * * 1-5    Asia/Shanghai   true      Mon 08:00
```

**`version` — 查看版本**

```bash
node dist/cli.js version
# MinGate v1.0.0
```

---

## 8. 记忆系统

MinGate 内置**三层人类记忆模型**，模拟人类的工作记忆、短期记忆和长期记忆。

### 8.1 三层架构

```
┌─────────────────────────────────────────────────────┐
│                  工作记忆（Working Memory）            │
│  当前会话对话记录，在内存中维护，会话结束后不单独存文件   │
└────────────────────────┬────────────────────────────┘
                         │ 空闲 consolidateIdleMinutes 分钟后触发整合
                         ▼
┌─────────────────────────────────────────────────────┐
│                 短期记忆（Short-term Memory）          │
│  ~/.mingate/memory/short_term/YYYY-MM-DD.md          │
│  按日存储对话摘要，超过 shortTermDays 天后自动删除      │
└────────────────────────┬────────────────────────────┘
                         │ 每周日 03:00 由 weekly cron 升级重要内容
                         ▼
┌─────────────────────────────────────────────────────┐
│                 长期记忆（Long-term Memory）           │
│  ~/.mingate/memory/long_term/                        │
│  facts.md / preferences.md / projects/<name>.md     │
│  永久保存，不自动删除                                  │
└─────────────────────────────────────────────────────┘
```

### 8.2 各层详解

#### 工作记忆

- 即当前对话的消息历史，存在内存中
- 超过 `maxTokens` 限制时，`context.ts` 会对上下文进行裁剪
- 会话不持久化到独立文件（摘要会进入短期记忆）

#### 短期记忆

- 存储位置：`~/.mingate/memory/short_term/YYYY-MM-DD.md`
- 每次空闲整合时，系统静默调用模型将当日对话摘要写入当天文件
- 超过 `shortTermDays`（默认 14 天）的文件会被自动删除

#### 长期记忆

- 存储位置：`~/.mingate/memory/long_term/`
- 包含三类文件：

| 文件 | 内容 |
|------|------|
| `facts.md` | 用户基本信息（姓名、职业、所在地等） |
| `preferences.md` | 用户偏好（语言风格、习惯等） |
| `projects/<name>.md` | 特定项目的上下文信息 |

- 每条记忆条目带有访问元数据：

```markdown
<!-- entry: last_accessed=2026-03-28, access_count=7 -->
用户叫张三，是一名产品经理，在北京工作。

<!-- entry: last_accessed=2026-01-10, access_count=1 -->
用户曾提到想学习 Rust。
```

### 8.3 自动触发机制

| 触发条件 | 行为 |
|---------|------|
| 对话空闲 `consolidateIdleMinutes` 分钟（默认 30 分钟） | 系统静默调用模型整合对话摘要到短期记忆，并将新的事实/偏好写入长期记忆 |
| 每周日 03:00（服务器本地时间） | `weekly.ts` 将短期记忆中重要内容升级到长期记忆 |

### 8.4 模型主动使用记忆

在对话过程中，模型可以主动调用以下内置工具：

| 工具 | 说明 |
|------|------|
| `memory_search` | 在记忆中检索相关信息 |
| `memory_save` | 向记忆中写入新信息 |

这些工具调用对用户透明，模型会根据对话内容自主判断何时需要检索或保存记忆。

### 8.5 手动编辑记忆

所有记忆文件均为**纯 Markdown 格式**，可以：

- 直接用文本编辑器打开编辑
- 通过 Web 控制台的"记忆"标签页查看和编辑
- 删除不需要的条目（直接删除对应的 `<!-- entry -->` 块及其内容即可）

---

## 9. Web 控制台

Web 控制台是 MinGate 内置的管理界面，通过浏览器访问。

### 访问地址

```
http://localhost:3000
```

（若修改了端口或通过域名访问，请相应调整）

### 鉴权

若 `.env` 中设置了 `MINGATE_TOKEN`，首次访问时会弹出 Token 输入框。输入后 Token 会存储在浏览器的 `localStorage` 中，后续访问无需重复输入。

若未设置 `MINGATE_TOKEN`，控制台对所有能访问该地址的人开放——**生产环境请务必设置 Token**。

### 标签页说明

#### 健康（Health）

实时显示各渠道 Bot 的连接状态：

| 显示项 | 说明 |
|-------|------|
| Telegram Bot 状态 | 是否已成功连接（Webhook 或长轮询） |
| 飞书 Bot 状态 | 是否已成功接收飞书事件 |

若某个渠道显示异常，可在此页面快速定位问题。

#### 对话（Sessions）

- 列出所有历史和活跃会话
- 点击会话可查看完整对话记录（transcript）
- 提供"手动触发记忆整合"按钮，无需等待空闲超时即可立即整合当前会话

#### 记忆（Memory）

- 查看和编辑 `facts.md`（事实）
- 查看和编辑 `preferences.md`（偏好）
- 查看短期记忆文件列表（按日期）
- 支持在界面上直接修改内容并保存

#### 定时任务（Cron）

- 列出 `config.json` 中配置的所有定时任务
- 显示每个任务的下次运行时间
- 支持**启用/禁用**单个任务
- 提供**立即运行**按钮，可跳过等待时间直接执行任务

#### 配置（Config）

- 显示当前加载的 `config.json` 内容
- 敏感字段（如 API Key）自动脱敏显示，不会泄露明文
- 仅供查看，不支持在线编辑（需手动编辑文件后重启）

---

## 10. 定时任务（Cron）

MinGate 内置定时任务支持，可以按计划自动向指定用户发送 AI 生成的消息。

### 配置方式

在 `config.json` 的 `cron.jobs` 数组中添加任务：

```json
"cron": {
  "jobs": [
    {
      "id": "morning-brief",
      "schedule": "0 8 * * 1-5",
      "prompt": "给我发一个今天的日程提醒",
      "deliverTo": {
        "channel": "telegram",
        "peerId": "+8613800000000"
      },
      "tz": "Asia/Shanghai",
      "enabled": true
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 任务唯一标识，建议使用英文和连字符 |
| `schedule` | string | 是 | 标准 5 段 Cron 表达式 |
| `prompt` | string | 是 | 触发时发给模型的提示词，模型根据此提示生成并发送消息 |
| `deliverTo.channel` | string | 是 | 投递渠道：`"telegram"` 或 `"feishu"` |
| `deliverTo.peerId` | string | 是 | 投递目标：Telegram 填手机号，飞书填 open_id |
| `tz` | string | 否 | 时区标识符，默认 `"UTC"`，中国用户推荐 `"Asia/Shanghai"` |
| `enabled` | boolean | 是 | `true` 启用，`false` 禁用 |

### Cron 表达式格式

```
┌───── 分钟 (0-59)
│ ┌───── 小时 (0-23)
│ │ ┌───── 日期 (1-31)
│ │ │ ┌───── 月份 (1-12)
│ │ │ │ ┌───── 星期 (0-7, 0 和 7 都是周日)
│ │ │ │ │
* * * * *
```

**常用示例：**

| 表达式 | 含义 |
|--------|------|
| `0 8 * * 1-5` | 工作日（周一至周五）早上 8:00 |
| `0 9 * * 1` | 每周一早上 9:00 |
| `30 12 * * *` | 每天中午 12:30 |
| `0 0 1 * *` | 每月 1 日零点 |

### 注意事项

- `deliverTo.peerId` 必须在对应渠道的 `allowFrom` 白名单中，否则消息无法投递
- 时区设置影响触发时间：建议明确指定 `tz` 而非依赖服务器默认时区
- 可在 Web 控制台的"定时任务"标签页立即运行任务，无需修改 schedule

### 多任务示例

```json
"cron": {
  "jobs": [
    {
      "id": "morning-brief",
      "schedule": "0 8 * * 1-5",
      "prompt": "给我发一个今天的工作日程提醒，语气轻松",
      "deliverTo": { "channel": "telegram", "peerId": "+8613800000000" },
      "tz": "Asia/Shanghai",
      "enabled": true
    },
    {
      "id": "weekly-review",
      "schedule": "0 18 * * 5",
      "prompt": "帮我总结一下这周的工作重点，并给出下周的建议",
      "deliverTo": { "channel": "feishu", "peerId": "ou_xxxxxxxxxx" },
      "tz": "Asia/Shanghai",
      "enabled": true
    },
    {
      "id": "night-reminder",
      "schedule": "0 22 * * *",
      "prompt": "提醒我睡前回顾今日待办事项",
      "deliverTo": { "channel": "telegram", "peerId": "+8613800000000" },
      "tz": "Asia/Shanghai",
      "enabled": false
    }
  ]
}
```

---

## 11. Docker 部署

推荐在生产环境使用 Docker 部署 MinGate，便于管理和迁移。

### Dockerfile

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
COPY ui/ ./ui/
CMD ["node", "dist/main.js"]
```

### 构建镜像

```bash
# 先构建 TypeScript
npm run build

# 构建 Docker 镜像
docker build -t mingate .
```

### 运行容器

```bash
docker run -d \
  --name mingate \
  -p 3000:3000 \
  -v ~/.mingate:/root/.mingate \
  --env-file ~/.mingate/.env \
  mingate
```

**参数说明：**

| 参数 | 说明 |
|------|------|
| `-d` | 后台运行 |
| `--name mingate` | 容器名称 |
| `-p 3000:3000` | 端口映射（宿主机:容器） |
| `-v ~/.mingate:/root/.mingate` | 挂载数据目录（持久化配置和记忆文件） |
| `--env-file ~/.mingate/.env` | 从文件加载环境变量 |

### 常用 Docker 操作

```bash
# 查看运行日志
docker logs -f mingate

# 停止容器
docker stop mingate

# 重启容器（配置变更后）
docker restart mingate

# 删除容器
docker rm mingate

# 进入容器执行 CLI
docker exec mingate node dist/cli.js list
```

### 使用 docker-compose（推荐）

创建 `docker-compose.yml`：

```yaml
version: '3.8'
services:
  mingate:
    image: mingate
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ~/.mingate:/root/.mingate
    env_file:
      - ~/.mingate/.env
```

```bash
# 启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

### 反向代理（Nginx 示例）

在生产环境中，建议通过 Nginx 反向代理并启用 HTTPS（Telegram Webhook 要求 HTTPS）：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 12. 安全说明

### 必须遵守的安全规则

1. **永远不要将 `.env` 文件提交到 Git**
   - `.env` 中包含 Bot Token、API Key 等高度敏感信息
   - 在 `.gitignore` 中明确添加 `.env`

2. **生产环境必须设置 `MINGATE_TOKEN`**
   - 未设置时，任何能访问 3000 端口的人都可以查看对话记录和记忆文件
   - Token 应使用足够复杂的随机字符串（建议 32 位以上）

3. **不要在生产环境使用 `allowFrom: ["*"]`**
   - `["*"]` 允许任何人与你的 AI 助理对话
   - 仅在开发/测试环境临时使用

### 已内置的安全机制

| 机制 | 实现方式 | 说明 |
|------|---------|------|
| Telegram Webhook 验证 | `X-Telegram-Bot-Api-Secret-Token` 请求头 | 防止伪造的 Webhook 请求 |
| 飞书事件验证 | SHA-256 HMAC 签名 | 防止伪造的飞书事件 |
| 速率限制 | 每 IP 每分钟 20 次请求 | 超出后封锁 5 分钟 |
| Web 控制台鉴权 | Bearer Token（存储于 localStorage） | 保护控制台访问 |
| 用户白名单 | `allowFrom` 配置 | 只有白名单用户可以发送消息 |

### 速率限制说明

- 限制规则：每个 IP 地址每分钟最多 **20 次**请求
- 触发后锁定：超出限制后，该 IP 会被**封锁 5 分钟**
- 适用范围：所有 HTTP 端点（Webhook、Web 控制台 API 等）

### config.json 安全性

`config.json` 不含任何密钥，可以安全地纳入版本控制：

```
可以提交 Git:   config.json, soul.md, ui/index.html
禁止提交 Git:   .env
```

---

## 13. 故障排查

### 常见问题速查表

| 现象 | 可能原因 | 解决方案 |
|------|---------|---------|
| Bot 不响应消息 | Bot Token 错误，或 Webhook 未正确注册 | 打开 Web 控制台"健康"标签，确认连接状态；检查 Bot Token |
| Web 控制台显示"Unauthorized" | `MINGATE_TOKEN` 未正确输入 | 在弹出框中输入正确的 `MINGATE_TOKEN` |
| 配对码无效 | 配对码已过期（超过 1 小时） | 让用户重新发送一条消息，MinGate 会生成新配对码 |
| 记忆没有被保存 | 记忆功能被禁用 | 检查 `config.json` 中 `memory.enabled` 是否为 `true` |
| 飞书签名验证失败 | `FEISHU_VERIFICATION_TOKEN` 填写错误 | 在飞书开放平台重新确认 Verification Token 并更新 `.env` |
| 定时任务消息未发出 | `peerId` 不在白名单中 | 确保 `deliverTo.peerId` 已在对应渠道的 `allowFrom` 中 |
| 服务启动失败 | Node.js 版本不满足要求 | 确保 Node.js >= 22（`node --version` 检查） |
| 飞书消息延迟 | 服务器与飞书之间网络问题 | 检查服务器网络；飞书事件有 3 秒超时，确保响应及时 |

### 查看日志

```bash
# 直接启动时查看实时日志
npm start 2>&1 | tee mingate.log

# Docker 部署时
docker logs -f mingate

# 过滤错误信息
docker logs mingate 2>&1 | grep -i error
```

### 验证 Telegram Webhook 状态

```bash
# 查询当前 Webhook 信息
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo
```

返回示例：
```json
{
  "ok": true,
  "result": {
    "url": "https://your-domain.com/telegram/webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "last_error_date": 0,
    "max_connections": 40
  }
}
```

若 `url` 为空，说明 Webhook 未注册，请检查 `TELEGRAM_PUBLIC_URL` 配置。

### 手动触发记忆整合

若记忆没有按预期整合，可通过 Web 控制台"对话"标签页中的"手动触发记忆整合"按钮立即执行，无需等待空闲超时。

### 重置特定用户的记忆

若需要清除某用户的记忆数据：

```bash
# 删除短期记忆（谨慎操作）
rm ~/.mingate/memory/short_term/YYYY-MM-DD.md

# 编辑长期记忆（推荐通过文本编辑器修改而非直接删除）
nano ~/.mingate/memory/long_term/facts.md
```

---

## 附录：快速参考

### 环境变量汇总

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `MINGATE_TOKEN` | 强烈建议 | Web 控制台访问 Token |
| `TELEGRAM_BOT_TOKEN` | 使用 Telegram 时必填 | Telegram Bot Token |
| `TELEGRAM_PUBLIC_URL` | Webhook 模式必填 | 服务器公网 HTTPS 地址 |
| `FEISHU_APP_SECRET` | 使用飞书时必填 | 飞书应用 Secret |
| `FEISHU_VERIFICATION_TOKEN` | 使用飞书时必填 | 飞书事件验证 Token |
| `MODEL_API_KEY` | 必填 | Anthropic 或 OpenAI API Key |
| `MINGATE_DATA_DIR` | 可选 | 自定义数据目录路径 |

### npm 脚本汇总

| 命令 | 说明 |
|------|------|
| `npm install` | 安装依赖 |
| `npm run build` | 编译 TypeScript 到 `dist/` |
| `npm start` | 生产模式启动（需先 build） |
| `npm run dev` | 开发模式启动（ts-node，无需 build） |

### 文件位置速查

| 文件 | 位置 | 说明 |
|------|------|------|
| 主配置 | `~/.mingate/config.json` | 非敏感配置 |
| 环境变量 | `~/.mingate/.env` | 敏感凭证 |
| 系统提示词 | `~/.mingate/soul.md` | 助理人格定义 |
| 事实记忆 | `~/.mingate/memory/long_term/facts.md` | 用户基本信息 |
| 偏好记忆 | `~/.mingate/memory/long_term/preferences.md` | 用户偏好 |
| 短期记忆 | `~/.mingate/memory/short_term/YYYY-MM-DD.md` | 每日对话摘要 |
| 项目记忆 | `~/.mingate/memory/long_term/projects/<name>.md` | 项目上下文 |

---

*本文档适用于 MinGate 当前版本。如有配置格式变更，请以项目源码为准。*
