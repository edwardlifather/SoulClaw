# 极简重设计方案：MinGate（飞书 + Telegram）

> 对比 OpenClaw，用中文说明。目标：同等核心功能，代码量约为原来的 5–6%，去除一切不必要的抽象。

---

## 一、设计哲学对比

| 维度 | OpenClaw | MinGate（本方案） |
|------|----------|-------------------|
| 定位 | 通用 AI 网关，支持 22+ 渠道，面向社区发布 | 个人/小团队自用，只支持飞书 + Telegram |
| System prompt | 几百行默认 system prompt，含大量工具说明、安全注意事项 | **默认无 system prompt**；用户可放 `soul.md` 定义个性 |
| 记忆 | 可选插件（bundled JSONL / QMD 向量检索），默认关闭 | **内置人类记忆模型**，默认开启，无需额外配置 |
| 插件架构 | 90 个 extension 包，每个实现 8 个 surface 接口 | 无插件系统，渠道代码直接写在 `src/channels/` 下 |
| 配置 | JSON5，Zod schema，~15k 行生成代码 | 单个 JSON 配置文件，~300 行加载代码 |
| 代码量 | ~128,000 行 | 目标 ~6,500 行 |

---

## 二、System Prompt 策略

### OpenClaw 的做法

OpenClaw 的默认 system prompt 极长，每次 API 调用都带着几千 token 的"前缀税"，内容包含：
- 工具列表描述（每个 tool 都要解释用途）
- 安全警告（"你是一个 AI，不要做坏事"）
- 格式化约束（"回复要简洁"）
- 渠道上下文（"你在 Telegram 群里，@mention 才触发"）
- 记忆注入（从 memory store 检索出的内容拼接进去）

### MinGate 的做法

**默认 system prompt 为空**——模型的原始行为，不强加任何框架。

用户在配置目录里放 `soul.md`，内容完全由用户决定：

```markdown
# ~/.mingate/soul.md 示例
你是 Alex，我的私人助理。
风格：直接、不废话、偶尔幽默。
不要解释你是 AI。
```

每次调用时，system prompt 的完整结构如下（顺序固定）：

```
[soul.md 内容，如果文件存在]
[一行渠道上下文，如：「当前对话来自飞书群「产品讨论」」]
```

如果 soul.md 不存在，system prompt 就是那一行渠道上下文。如果连这行也不想要，可以在配置里关掉。

**工具描述不进 system prompt**——通过 JSON Schema 的 `tools` 字段传给模型，模型自己会看，不需要在 system prompt 里解释。

### 与 OpenClaw BOOT.md 的区别

OpenClaw 的 `BOOT.md` 是网关**启动时**执行的一段 prompt（相当于初始化脚本），和 agent 人格无关。而且 OpenClaw 无论有没有 BOOT.md，默认 system prompt 照样存在。

MinGate 的 `soul.md` 是唯一的 system prompt 来源，没有任何隐藏的"底层 prompt"。用户看到的就是模型收到的。

---

## 三、人类记忆模型

### 3.1 为什么不用 OpenClaw 的方式

OpenClaw 的记忆是可选插件，默认不开启，开启后依赖 sqlite-vec（原生模块）、lancedb（Rust 编译）、mcporter（MCP bridge 进程）。使用感是：把所有对话内容丢进向量数据库，每次调用时用相似度检索 top-K 结果拼进 system prompt——**数据库检索感，不是记忆感**。另外用户无法直接查看或编辑记忆内容。

MinGate 的设计目标：**让 AI 拥有记忆，感觉像在回忆，而不是在查数据库。**

### 3.2 三层记忆结构

参考人类记忆的三个层次，用纯文件实现：

```
~/.mingate/memory/
├── short_term/
│   └── {YYYY-MM-DD}.md     ← 每天的对话摘要，保留 N 天后自动删除
└── long_term/
    ├── facts.md            ← 关于用户的事实（姓名、职业、习惯）
    ├── preferences.md      ← 用户偏好（写作风格、话题偏好等）
    └── projects/
        └── {name}.md       ← 每个项目一个文件，记录背景和进展
```

没有单独的 `working/` 目录——当前对话上下文就是 session transcript（JSONL），这已经是"工作记忆"，不需要额外存储。

所有文件都是**纯 Markdown**，人可读、可编辑、可用 Git 管理。

### 3.3 long_term 文件内的条目粒度

`facts.md` 和 `preferences.md` 不是单块文本，而是**按条目分段**，每个条目有独立的 front matter：

```markdown
<!-- entry: last_accessed=2026-03-28, access_count=7 -->
用户叫张三，是一名产品经理，在北京工作。

<!-- entry: last_accessed=2026-01-10, access_count=1 -->
用户曾提到想学习 Rust，但不确定是否还有兴趣。
```

`memory_search` 返回的是**匹配的条目片段**，而不是整个文件。检索逻辑：
1. 对 query 做关键词提取：英文按空格切词，中文按 bigram（相邻两字）切词
2. 扫描所有条目，统计关键词命中数
3. 按命中数 × `access_count` 加权排序，返回 top-N 条目
4. 被返回的条目更新 `last_accessed` 和 `access_count`

**中文 bigram 的缺陷**：查询"产品经理"会切出"产品"/"品经"/"经理"，"经理"也会匹配到含"总经理"的条目，产生噪声。这是精确度的取舍——相比向量检索召回率更低，但对个人使用（记忆条目总量通常不超过几百条）已经足够，且不需要任何外部依赖。如果未来条目增多导致误匹配明显，可以引入 jieba 分词，改动仅限 `search.ts` 一个文件。

这不需要任何向量数据库，约 150 行代码。

### 3.4 遗忘机制

遗忘不等于删除，而是**降低被检索到的概率**：

- `short_term/`：超过配置天数（默认 14 天）的文件，定时任务自动删除
- `long_term/` 条目：`access_count` 越低、`last_accessed` 越久，检索排名越靠后，逐渐淡出；永远不自动删除，用户可以手动清理

### 3.5 记忆生命周期

**对话进行中**（模型主动调用工具）：模型在需要时调用 `memory_search` 检索相关记忆，或调用 `memory_save` 保存新发现的信息。这两个动作完全由模型自主判断，系统不会强制触发。

**对话结束时**（N 分钟无新消息，可配置，默认 30 分钟）：

系统静默触发一次模型调用，提示词大意是"请总结刚才的对话，写入今天的短期记忆，如有新的用户事实或偏好请同时保存"。传入内容是本次 transcript 的最近 N 条消息（默认取最近 50 条，避免超出 context window），模型通过工具调用完成写入，结果不发给用户。

同一天可能有多次对话（Telegram 一次、飞书一次），都 append 到同一个 `short_term/{today}.md`，条目之间用时间戳分隔：

```markdown
## 2026-03-30 09:15 [telegram/+8613800000000]
讨论了 MinGate 的记忆设计，用户倾向于用 Markdown 而非数据库。

## 2026-03-30 14:40 [feishu/ou_xxx]
用户让 AI 帮忙写了一份飞书机器人的接入文档。
```

**每周一次定时任务**：

把最近 7 天的 `short_term/*.md` 全部读取（正常使用下约 3–8k token），触发一次模型调用，提示词大意是"请从这一周的摘要中提取反复出现的、重要的信息，用 memory_save 提升到长期记忆"。

### 3.6 暴露给模型的工具

```typescript
// 仅 3 个工具，通过 tool_use 格式传递，不进 system prompt

memory_search(query: string): string
// 返回相关条目的 Markdown 文本，最多返回 3000 token

memory_save(content: string, type: "fact" | "preference" | "project", project?: string): void
// type="fact"       → 追加到 long_term/facts.md
// type="preference" → 追加到 long_term/preferences.md
// type="project"    → 追加到 long_term/projects/{project}.md（project 参数必填）
//
// 防重复：保存前先对所有现有条目做相似度检查（同样用 bigram 命中率），
// 如果最相似条目命中率 > 80%，则更新该条目而非追加新条目。
// 这避免了模型每次对话都反复写入"用户叫张三"之类的重复内容。

memory_list_projects(): string[]
// 返回 long_term/projects/ 下的所有项目名称
```

---

## 四、功能对比总表

### 核心渠道功能

| 功能 | OpenClaw | MinGate |
|------|----------|---------|
| Telegram 支持 | ✅ | ✅ |
| 飞书支持 | ✅ | ✅ |
| 其他 20+ 渠道 | ✅ | ❌ 刻意不支持 |
| 群组/频道消息 | ✅ | ✅ |
| @mention 触发 | ✅ | ✅ |
| 私信 | ✅ | ✅ |
| 图片/文件收发 | ✅ | ✅（收图片转 base64 给模型，发文本/图片） |
| 多账号/多 bot | ✅ | ❌ 每渠道固定 1 个 bot |

### AI 能力

| 功能 | OpenClaw | MinGate |
|------|----------|---------|
| 多模型 provider | ✅ 8+ 个 | ✅ Anthropic + OpenAI |
| Streaming 回复 | ✅ | ✅ |
| 工具调用（function calling） | ✅ | ✅ |
| System prompt | 默认很长，框架控制 | **默认为空，soul.md 完全自定义** |
| 内置记忆 | 可选插件，需配置 | ✅ **内置，默认开启** |
| 人类三层记忆模型 | ❌ | ✅ 短期/长期/遗忘 |
| 上下文压缩 | ✅ 自动摘要 | ✅ 超过阈值时截断旧消息 + 摘要 |
| Thinking 模式 | ✅ | ✅（透传给 Anthropic API） |

### 自动化

| 功能 | OpenClaw | MinGate |
|------|----------|---------|
| Cron 定时任务 | ✅ | ✅ |
| 定时发送到渠道 | ✅ | ✅ |
| Webhook 外部触发 | ✅ | ❌ |
| Sub-agent / 多 agent 协作 | ✅ ACP spawn | ❌ |

### 安全

| 功能 | OpenClaw | MinGate |
|------|----------|---------|
| Gateway Token 认证 | ✅ | ✅ |
| allowFrom 白名单 | ✅ | ✅ |
| DM 陌生人配对流程 | ✅ 配对码 + CLI approve | ✅ 同样的流程，简化实现 |
| Webhook HMAC 验证 | ✅ | ✅（飞书 + Telegram 都做） |
| 工具调用 deny list | ✅ 细粒度 per-agent | ✅ 简单全局白名单 |
| 请求频率限制 | ✅ | ✅ 简单计数 |
| Docker 沙箱隔离 | ✅ | ❌ |
| Tailscale 集成 | ✅ | ❌ |

### 界面与运维

| 功能 | OpenClaw | MinGate |
|------|----------|---------|
| Web 控制台 | ✅ React + Vite | ✅ 单页 HTML（~500 行）查看对话历史、管理配置、触发记忆整理 |
| CLI | ✅ | ✅ 极简 CLI（~400 行） |
| 原生 App（macOS/iOS/Android） | ✅ | ❌ 直接用飞书/Telegram 客户端 |
| Docker 部署 | ✅ | ✅ |
| 健康检查 `/healthz` | ✅ | ✅ |
| 日志 | ✅ 结构化 + tag | ✅ 简单文件日志 |
| OpenTelemetry | ✅ | ❌ |

---

## 五、配置设计

### OpenClaw 的配置（理解成本高）

```json5
// openclaw.json（节选，实际更长）
{
  gateway: { port: 18789, bind: "lan", auth: { token: "$secretref:gateway_token" } },
  channels: {
    telegram: { token: "$secretref:tg_token", allowFrom: [...], dmPolicy: "pairing" },
    feishu: { appId: "...", appSecret: "$secretref:feishu_secret", ... }
  },
  agents: {
    defaults: { model: "claude-3-5-sonnet", provider: "anthropic", thinking: "medium" },
    bindings: [{ channel: "telegram", peer: { kind: "dm", id: "+1..." }, agentId: "coder" }],
    memory: { enabled: true, collections: [...] }
  },
  models: { ... },
  cron: { jobs: [...] }
}
```

用户需要理解：JSON5 格式、secretref 机制、binding 优先级、provider 抽象层。

### MinGate 的配置（看名字就懂）

敏感值（token、API key）**不写进 config.json**，通过环境变量注入：

```bash
# .env 文件（不提交 git）
MINGATE_TOKEN=your-gateway-token      # Web 控制台和 CLI 的访问令牌，不设则控制台无需认证（仅建议本地开发时省略）
TELEGRAM_BOT_TOKEN=...
FEISHU_APP_SECRET=...                 # 飞书 app secret，用于 API 调用签名
FEISHU_VERIFICATION_TOKEN=...         # 飞书 webhook 验签 token，用于验证消息来源
MODEL_API_KEY=sk-ant-...
```

```json
// ~/.mingate/config.json（可提交 git，无敏感值）
{
  "port": 3000,
  "telegram": {
    "allowFrom": ["+8613800000000", "+8613900000000"]
  },
  "feishu": {
    "appId": "cli_xxx",               // appId 是飞书应用的公开标识符，等同于 OAuth client_id，非敏感
    "allowFrom": ["ou_xxx", "ou_yyy"]
  },
  "model": {
    "provider": "anthropic",
    "model": "claude-opus-4-6"
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
        "deliverTo": { "channel": "telegram", "peerId": "+8613800000000" }
      }
    ]
  }
}
```

`deliverTo` 里必须指定 `peerId`——因为同一渠道可能有多个 allowFrom 用户，不能隐式猜测发给谁。

---

## 六、Web 控制台功能说明

Web 控制台是单文件 `ui/index.html`（含内联 JS，无构建步骤），提供以下功能：

| 功能 | 说明 |
|------|------|
| 对话历史 | 按渠道/用户列出所有 session，可翻阅 transcript |
| 记忆浏览 | 查看 `short_term/` 和 `long_term/` 的 Markdown 文件，支持直接编辑 |
| 手动触发记忆整理 | 不等 30 分钟，立即触发指定 session 的对话摘要写入 |
| Cron 管理 | 列出定时任务，启用/禁用，手动触发一次 |
| 配置查看 | 显示当前 config.json（脱敏，不显示 .env 里的 token） |
| 健康状态 | 显示 Telegram/飞书 bot 的连接状态和最近一次错误 |

不支持：实时聊天（直接用飞书/Telegram 聊）、修改 soul.md（直接编辑文件）、用户管理（用 allowFrom 配置）。

---

## 七、省掉了什么（有意为之）

| 省掉的功能 | 理由 |
|-----------|------|
| 插件系统 / extension 架构 | 只支持 2 个渠道，无需抽象层 |
| 22+ 渠道 | 需求本就是飞书 + Telegram |
| iOS / Android / macOS App | 用飞书/Telegram 原生客户端就是最好的 UI |
| Canvas / A2UI 可视化工作区 | 复杂且罕用 |
| Sub-agent / ACP spawn | 单 agent 够用 |
| OpenTelemetry | 个人用不需要 |
| Tailscale 集成 | 用户自己配反向代理 |
| secretref / 加密 auth store | 环境变量 + .env 文件，够了 |
| 生成的 schema（~15k 行） | 不需要描述 90 个渠道的 schema |
| npm 发布 / Sparkle 自动更新 | 自用，`git pull && npm start` 即可 |
| 多 agent binding 路由 | 一个 agent 服务所有对话 |
| Docker sandbox | 个人部署，信任自己的 agent |
| 语音唤醒 / Live Activity | 手机 app 原生支持 |

---

## 八、代码结构与行数

```
src/
├── main.ts                  ← 启动入口（~50 行）
├── config.ts                ← 配置加载与环境变量解析（~200 行）
├── gateway/
│   ├── server.ts            ← HTTP + WebSocket 服务（~200 行）
│   └── auth.ts              ← Token 认证 + 速率限制（~150 行）
├── channels/
│   ├── telegram.ts          ← Telegram Bot API 收发（~600 行）
│   └── feishu.ts            ← 飞书 webhook 收发 + HMAC 验证（~800 行）
├── agent/
│   ├── runner.ts            ← 模型调用 + 工具循环 + streaming（~800 行）
│   ├── context.ts           ← 上下文裁剪 + 摘要压缩（~200 行）
│   └── tools/
│       ├── message.ts       ← 发消息工具（~100 行）
│       └── memory.ts        ← memory_search / memory_save（~200 行）
├── memory/
│   ├── store.ts             ← Markdown 文件读写 + 条目解析（~250 行）
│   ├── search.ts            ← 关键词检索 + 权重排序（~150 行）
│   ├── consolidate.ts       ← 对话结束后触发摘要写入（~200 行）
│   └── weekly.ts            ← 每周 cron：short_term → long_term 提升（~150 行）
├── session/
│   ├── store.ts             ← JSONL transcript 读写（~250 行）
│   └── routing.ts           ← 消息路由（channel + peerId → session）（~150 行）
├── security/
│   ├── allowlist.ts         ← allowFrom 白名单检查（~100 行）
│   └── pairing.ts           ← DM 陌生人配对码流程（~200 行）
├── cron/
│   └── service.ts           ← cron 表达式解析 + 定时触发（~300 行）
└── ui/
    └── index.html           ← Web 控制台（~500 行，单文件，含 JS）

配置与辅助文件（不计入"功能代码"）：
  package.json, tsconfig.json, Dockerfile
  .env.example
  soul.md.example            ← 示例 soul.md，供用户参考
```

**行数汇总：**

| 模块 | 行数 |
|------|------|
| 入口 / 配置 | 250 |
| Gateway（HTTP/WS/Auth） | 350 |
| 渠道（Telegram + 飞书） | 1,400 |
| Agent（Runner + Context + Tools） | 1,300 |
| Memory（Store + Search + Consolidate + Weekly） | 750 |
| Session（Store + Routing） | 400 |
| Security（Allowlist + Pairing） | 300 |
| Cron | 300 |
| Web UI | 500 |
| **合计** | **~5,550 行** |

加上类型定义文件（`types.ts` 等，约 300 行）和测试文件（单元测试，约 600 行）：**总计约 6,500 行**。

---

## 九、总结

| | OpenClaw | MinGate |
|--|----------|---------|
| 代码量 | ~128,000 行 | ~6,500 行（**约 5%**） |
| 渠道支持 | 22+ | 2（飞书、Telegram） |
| AI provider | 8+ | 2（Anthropic、OpenAI） |
| System prompt | 框架强制注入，用户覆盖困难 | **默认为空，soul.md 完全掌控** |
| 记忆 | 可选插件，重依赖，黑盒 | **内置，Markdown 文件，透明可编辑** |
| 记忆的"感觉" | 数据库检索 | **像在回忆（短期/长期/遗忘）** |
| 配置 | JSON5 + secretref + binding + provider 抽象 | JSON + 环境变量，看名字就懂 |
| 部署 | Docker，memory 插件开启时需要额外原生依赖 | `node src/main.ts` 或一行 Docker，零额外依赖 |
| 适合场景 | 开源产品，面向社区，多渠道 | **个人/小团队自用，够用就好** |

**核心取舍**：OpenClaw 是设计给全世界用的产品，插件系统、抽象层、生成 schema、细粒度权限控制都是必要的——对它的定位而言。MinGate 是为自己造的工具，代码复杂度和实际需求精确匹配，没有多余的一行。

---

*如需开始写代码，建议从 `src/channels/telegram.ts` 和 `src/agent/runner.ts` 入手，这两个文件定义了系统最核心的两条数据流。*
