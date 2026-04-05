# 极简重设计方案：MinGate�E�飞书 + Telegram�E�E
> 对毁EOpenClaw�E�用中斁E��明。目栁E��同等核忁E��能�E�代码E��约为原来皁E5 E%�E�去除一刁E��忁E��的抽象、E
---

## 一、设计哲学对毁E
| 维度 | OpenClaw | SoulClaw�E�本方案！E|
|------|----------|-------------------|
| 定佁E| 通用 AI 网�E�E�支持E22+ 渠道，面向社区发币E| 个人/小团队�E用�E�只支持E��书 + Telegram |
| System prompt | 几百行默认 system prompt�E�含大量工具说明、安�E注意事项 | **默认无 system prompt**�E�用户可放 `soul.md` 定义个性 |
| 记忁E| 可选插件�E�Eundled JSONL / QMD 向量检索�E�，默认关闭 | **冁E��人类记忁E��垁E*�E�默认开启�E�无需额外�E置 |
| 插件架极E| 90 个 extension 匁E��每个实现 8 个 surface 接口 | 无插件系统，渠道代码直接写在 `src/channels/` 丁E|
| 配置 | JSON5�E�Zod schema�E�~15k 行生成代码E| 单个 JSON 配置斁E���E�~300 行加载代码E|
| 代码E�� | ~128,000 衁E| 目栁E~6,500 衁E|

---

## 二、System Prompt 策略

### OpenClaw 皁E��況E
OpenClaw 皁E��认 system prompt 极E���E�每次 API 谁E��都带着几十Etoken 皁E前缀稁E�E��E容匁E���E�E- 工具列表描述�E�每个 tool 都要解释用途！E- 安�E警告！E你是一个 AI�E�不要做坏亁E�E�E- 格式化约束！E回复要简洁E�E�E- 渠道上下文�E�E你在 Telegram 群里，@mention 才触叁E�E�E- 记忁E��入�E�仁Ememory store 检索出皁E�E容拼接进去�E�E
### SoulClaw 皁E��況E
**默认 system prompt 为空**——模型的原始行为�E�不强加任何桁E��、E
用户在配置目录里放 `soul.md`�E��E容完�E由用户决定！E
```markdown
# ~/.SoulClaw/soul.md 示侁E你是 Alex�E��E皁E��人助琁E��E风格�E�直接、不废话、�E尔幽默、E不要解释你是 AI、E```

每次谁E��时�E�system prompt 皁E��整结构如下（顺序固定）！E
```
[soul.md 冁E���E�如果斁E��存在]
[一行渠道上下文�E�如：「当前对话来自飞书群「产品讨论」」]
```

如果 soul.md 不存在�E�system prompt 就是那一行渠道上下文。如果连这行也不想要E��可以在配置里�E掉、E
**工具描述不迁Esystem prompt**——通迁EJSON Schema 皁E`tools` 字段传给模型，模型�E己会看�E�不需要在 system prompt 里解释、E
### 丁EOpenClaw BOOT.md 皁E��别

OpenClaw 皁E`BOOT.md` 是网�E**启动时**执行的一段 prompt�E�相当于�E始化脚本�E�，和 agent 人格无关。而丁EOpenClaw 无论有没朁EBOOT.md�E�默认 system prompt 照样存在、E
SoulClaw 皁E`soul.md` 是唯一皁Esystem prompt 来源，没有任何隐藏的"底屁Eprompt"。用户看到皁E��是模型收到皁E��E
---

## 三、人类记忁E��垁E
### 3.1 为什么不用 OpenClaw 皁E��弁E
OpenClaw 皁E��忁E��可选插件�E�默认不开启�E�开启后依赁Esqlite-vec�E�原生模块）、lancedb�E�Eust 编译）、mcporter�E�ECP bridge 进程）。使用感是�E�把所有对话�E容丢进向量数据库，每次谁E��时用相似度检索 top-K 结果拼迁Esystem prompt— E*数据库检索感，不是记忁E��**。另外用户无法直接查看�E编辑记忁E�E容、E
SoulClaw 皁E��计目栁E��E*让 AI 拥有记忁E��感觉像在回忁E��而不是在查数据库、E*

### 3.2 三层记忁E��构

参老E��类记忁E��三个层次�E�用纯斁E��实现�E�E
```
~/.SoulClaw/memory/
├── short_term/
━E  └── {YYYY-MM-DD}.md     ↁE每天皁E��话摘要E��保留 N 天后�E动删除
└── long_term/
    ├── facts.md            ↁE关于用户皁E��实（姓名、职业、习惯�E�E    ├── preferences.md      ↁE用户偏好�E��E作风格、话题偏好等！E    └── projects/
        └── {name}.md       ↁE每个项目一个斁E���E�记录背景和进屁E```

没有单独皁E`working/` 目录——当前对话上下文就是 session transcript�E�ESONL�E�，这已经是"工作记忁E�E�不需要E��外存储、E
所有文件都是**纯 Markdown**�E�人可读、可编辑、可用 Git 管琁E��E
### 3.3 long_term 斁E��冁E��条目粒度

`facts.md` 咁E`preferences.md` 不是单块斁E���E�而是**按条目刁E��**�E�每个条目有独立的 front matter�E�E
```markdown
<!-- entry: last_accessed=2026-03-28, access_count=7 -->
用户叫张三，是一名产品经理�E�在北京工作、E
<!-- entry: last_accessed=2026-01-10, access_count=1 -->
用户曾提到想学习 Rust�E�佁E��确定是否还有兴趣、E```

`memory_search` 返回皁E��**匹配的条目牁E��**�E�而不是整个斁E��。检索逻辑！E1. 对 query 做�E键词提取：英斁E��空格刁E��，中斁E�� bigram�E�相邻两字）�E证E2. 扫描所有条目�E�统计关键词命中数
3. 按命中数 ÁE`access_count` 加杁E��序，返回 top-N 条目
4. 被返回皁E��目更新 `last_accessed` 咁E`access_count`

**中斁Ebigram 皁E��陷**�E�查询"产品经理"会�E出"产品E/"品绁E/"经理"�E�E经理"也会匹配到含"总经理"皁E��目�E�产生噪声。这是精确度皁E��舍——相比向量检索召回率更低，佁E��个人使用�E�记忁E��目总量通常不趁E��E�E百条�E�已经足够，且不需要任何外部依赖。如果未来条目增多导致误匹配�E显�E�可以引�E jieba 刁E��，改动仁E�� `search.ts` 一个斁E��、E
这不需要任何向量数据库，约 150 行代码、E
### 3.4 遗忘机制

遗忘不等于删除�E�而是**降低被检索到皁E��率**�E�E
- `short_term/`�E�趁E��E�E置天数�E�默认 14 天�E�的斁E���E�定时任务自动删除
- `long_term/` 条目�E�`access_count` 越低、`last_accessed` 越乁E��检索排名越靠后，逐渐淡出�E�永远不�E动删除�E�用户可以手动渁E��

### 3.5 记忁E��命周朁E
**对话进行中**�E�模型主动谁E��工具�E�：模型在需要时谁E�� `memory_search` 检索相关记忁E���E谁E�� `memory_save` 保存新发现皁E��息。这两个动作完�E由模型�E主判断�E�系统不会强制触发、E
**对话结束时**�E�E 刁E��无新消�E�E�可配置�E�默认 30 刁E���E�！E
系统静默触发一次模型谁E���E�提示词大意是"请总结�E才的对话，�E入今天皁E��期记忁E��如有新皁E��户事实�E偏好请同时保孁E。传入冁E��是本次 transcript 皁E��迁EN 条消�E�E�默认取最迁E50 条�E�避免趁E�E context window�E�，模型通迁E��具谁E��完�E写�E�E�结果不发给用户、E
同一天可能有多次对话！Eelegram 一次、E��书一次�E�，�E append 到同一个 `short_term/{today}.md`�E�条目之间用时间戳刁E���E�E
```markdown
## 2026-03-30 09:15 [telegram/+8613800000000]
讨论亁ESoulClaw 皁E��忁E��计�E�用户倾向于用 Markdown 而非数据库、E
## 2026-03-30 14:40 [feishu/ou_xxx]
用户让 AI 帮忙�E亁E��份飞书机器人皁E��入斁E��、E```

**每周一次定时任务**�E�E
把最迁E7 天皁E`short_term/*.md` 全部读取（正常使用下约 3 Ek token�E�，触发一次模型谁E���E�提示词大意是"请从这一周皁E��要中提取反复�E现皁E��E��要的信息�E�用 memory_save 提升到长期记忁E、E
### 3.6 暴露给模型的工具

```typescript
// 仁E3 个工具�E�通迁Etool_use 格式传递，不迁Esystem prompt

memory_search(query: string): string
// 返回相关条目皁EMarkdown 斁E���E�最多返回 3000 token

memory_save(content: string, type: "fact" | "preference" | "project", project?: string): void
// type="fact"       ↁE追加到 long_term/facts.md
// type="preference" ↁE追加到 long_term/preferences.md
// type="project"    ↁE追加到 long_term/projects/{project}.md�E�Eroject 参数忁E���E�E//
// 防重复：保存前先对所有现有条目做相似度检查�E�同样用 bigram 命中玁E��！E// 如果最相似条目命中玁E> 80%�E��E更新该条目而非追加新条目、E// 这避免亁E��型每次对话�E反复�E入"用户叫张丁E之类皁E��复�E容、E
memory_list_projects(): string[]
// 返回 long_term/projects/ 下的所有项目名称
```

---

## 四、功能对比总表

### 核忁E��道功能

| 功�E | OpenClaw | SoulClaw |
|------|----------|---------|
| Telegram 支持E| ✁E| ✁E|
| 飞书支持E| ✁E| ✁E|
| 其仁E20+ 渠遁E| ✁E| ❁E刻意不支持E|
| 群绁E频道消�E | ✁E| ✁E|
| @mention 触叁E| ✁E| ✁E|
| 私信 | ✁E| ✁E|
| 图牁E斁E��收叁E| ✁E| ✁E��收图牁E�� base64 给模型，发斁E��/图牁E��E|
| 多账号/夁Ebot | ✁E| ❁E每渠道固宁E1 个 bot |

### AI 能劁E
| 功�E | OpenClaw | SoulClaw |
|------|----------|---------|
| 多模垁Eprovider | ✁E8+ 个 | ✁EAnthropic + OpenAI |
| Streaming 回夁E| ✁E| ✁E|
| 工具谁E���E�Eunction calling�E�E| ✁E| ✁E|
| System prompt | 默认很长�E�桁E��控制 | **默认为空�E�soul.md 完�E自定乁E* |
| 冁E��记忁E| 可选插件�E�需配置 | ✁E**冁E���E�默认开启** |
| 人类三层记忁E��垁E| ❁E| ✁E短朁E长朁E遗忁E|
| 上下文压缩 | ✁E自动摘要E| ✁E趁E��E�E值时截断旧消�E + 摘要E|
| Thinking 模弁E| ✁E| ✁E��透传绁EAnthropic API�E�E|

### 自动匁E
| 功�E | OpenClaw | SoulClaw |
|------|----------|---------|
| Cron 定时任务 | ✁E| ✁E|
| 定时发送到渠遁E| ✁E| ✁E|
| Webhook 外部触叁E| ✁E| ❁E|
| Sub-agent / 夁Eagent 协佁E| ✁EACP spawn | ❁E|

### 安�E

| 功�E | OpenClaw | SoulClaw |
|------|----------|---------|
| Gateway Token 认证E| ✁E| ✁E|
| allowFrom 白名单 | ✁E| ✁E|
| DM 陌生人配对流稁E| ✁E配对码E+ CLI approve | ✁E同样皁E��程，简化实现 |
| Webhook HMAC 验证E| ✁E| ✁E��飞书 + Telegram 都做！E|
| 工具谁E�� deny list | ✁E绁E��度 per-agent | ✁E简单�E局白名单 |
| 请求频率限制 | ✁E| ✁E简单计数 |
| Docker 沙箱隔离 | ✁E| ❁E|
| Tailscale 雁E�E | ✁E| ❁E|

### 界面与运维

| 功�E | OpenClaw | SoulClaw |
|------|----------|---------|
| Web 控制台 | ✁EReact + Vite | ✁E单页 HTML�E�E500 行）查看对话历史、管琁E�E置、触发记忁E��琁E|
| CLI | ✁E| ✁E极简 CLI�E�E400 行！E|
| 原生 App�E�EacOS/iOS/Android�E�E| ✁E| ❁E直接用飞书/Telegram 客户端 |
| Docker 部署 | ✁E| ✁E|
| 健康检查 `/healthz` | ✁E| ✁E|
| 日忁E| ✁E结构匁E+ tag | ✁E简单文件日忁E|
| OpenTelemetry | ✁E| ❁E|

---

## 五、E�E置设计

### OpenClaw 皁E�E置�E�理解成本高！E
```json5
// openclaw.json�E�节选，实际更长�E�E{
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

用户需要理解�E�JSON5 格式、secretref 机制、binding 优�E级、provider 抽象层、E
### SoulClaw 皁E�E置�E�看名字就懂！E
敏感值�E�Eoken、API key�E�E*不�E迁Econfig.json**�E�通迁E��墁E��量注入�E�E
```bash
# .env 斁E���E�不提交 git�E�ESoulClaw_TOKEN=your-gateway-token      # Web 控制台咁ECLI 皁E��问令牌，不设则控制台无需认证E��仁E��议本地开发时省略�E�ETELEGRAM_BOT_TOKEN=...
FEISHU_APP_SECRET=...                 # 飞书 app secret�E�用亁EAPI 谁E��签吁EFEISHU_VERIFICATION_TOKEN=...         # 飞书 webhook 验签 token�E�用于验证消�E来溁EMODEL_API_KEY=sk-ant-...
```

```json
// ~/.SoulClaw/config.json�E�可提交 git�E�无敏感值�E�E{
  "port": 3000,
  "telegram": {
    "allowFrom": ["+8613800000000", "+8613900000000"]
  },
  "feishu": {
    "appId": "cli_xxx",               // appId 是飞书应用皁E�E开栁E��E���E�等同亁EOAuth client_id�E�非敏感
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
        "prompt": "给�E发一个今天皁E��程提醁E,
        "deliverTo": { "channel": "telegram", "peerId": "+8613800000000" }
      }
    ]
  }
}
```

`deliverTo` 里忁E��持E��E`peerId`——因为同一渠道可能有多个 allowFrom 用户�E�不�E隐式猜测发给谁、E
---

## 六、Web 控制台功�E说昁E
Web 控制台是单文件 `ui/index.html`�E�含冁E�� JS�E�无极E��步骤�E�，提供以下功能�E�E
| 功�E | 说昁E|
|------|------|
| 对话历史 | 按渠遁E用户列�E所朁Esession�E�可翻阁Etranscript |
| 记忁E��见E| 查省E`short_term/` 咁E`long_term/` 皁EMarkdown 斁E���E�支持直接编辁E|
| 手动触发记忁E��琁E| 不筁E30 刁E���E�立即触发指宁Esession 皁E��话摘要�E入 |
| Cron 管琁E| 列�E定时任务�E�启用/禁用�E�手动触发一次 |
| 配置查省E| 显示当前 config.json�E�脱敏，不显示 .env 里的 token�E�E|
| 健康状态E| 显示 Telegram/飞书 bot 皁E��接状态和最近一次错误 |

不支持E��实时聊天�E�直接用飞书/Telegram 聊）、修改 soul.md�E�直接编辑文件�E�、用户管琁E��用 allowFrom 配置�E�、E
---

## 丁E��省掉亁E��么（有意为之！E
| 省掉皁E��能 | 琁E�� |
|-----------|------|
| 插件系绁E/ extension 架极E| 只支持E2 个渠道，无需抽象屁E|
| 22+ 渠遁E| 需求本就是飞书 + Telegram |
| iOS / Android / macOS App | 用飞书/Telegram 原生客户端就是最好皁EUI |
| Canvas / A2UI 可见E��工作区 | 复杂且罕用 |
| Sub-agent / ACP spawn | 十Eagent 够用 |
| OpenTelemetry | 个人用不需要E|
| Tailscale 雁E�E | 用户自己配反向代琁E|
| secretref / 加寁Eauth store | 环墁E��釁E+ .env 斁E���E�够亁E|
| 生�E皁Eschema�E�E15k 行！E| 不需要描述 90 个渠道的 schema |
| npm 发币E/ Sparkle 自动更新 | 自用�E�`git pull && npm start` 即可 |
| 夁Eagent binding 路由 | 一个 agent 服务所有对证E|
| Docker sandbox | 个人部署�E�信任自己皁Eagent |
| 语音唤醁E/ Live Activity | 手机 app 原生支持E|

---

## 八、代码结构与行数

```
src/
├── main.ts                  ↁE启动入口�E�E50 行！E├── config.ts                ↁE配置加载与环墁E��量解析！E200 行！E├── gateway/
━E  ├── server.ts            ↁEHTTP + WebSocket 服务�E�E200 行！E━E  └── auth.ts              ↁEToken 认证E+ 速率限制�E�E150 行！E├── channels/
━E  ├── telegram.ts          ↁETelegram Bot API 收发！E600 行！E━E  └── feishu.ts            ↁE飞书 webhook 收叁E+ HMAC 验证E��E800 行！E├── agent/
━E  ├── runner.ts            ↁE模型谁E�� + 工具循环 + streaming�E�E800 行！E━E  ├── context.ts           ↁE上下文裁剪 + 摘要压缩�E�E200 行！E━E  └── tools/
━E      ├── message.ts       ↁE发消�E工具�E�E100 行！E━E      └── memory.ts        ↁEmemory_search / memory_save�E�E200 行！E├── memory/
━E  ├── store.ts             ↁEMarkdown 斁E��读冁E+ 条目解析！E250 行！E━E  ├── search.ts            ↁE关键词检索 + 杁E��排序！E150 行！E━E  ├── consolidate.ts       ↁE对话结束后触发摘要�E入�E�E200 行！E━E  └── weekly.ts            ↁE每周 cron�E�short_term ↁElong_term 提升�E�E150 行！E├── session/
━E  ├── store.ts             ↁEJSONL transcript 读写！E250 行！E━E  └── routing.ts           ↁE消�E路由�E�Ehannel + peerId ↁEsession�E�！E150 行！E├── security/
━E  ├── allowlist.ts         ↁEallowFrom 白名单检查�E�E100 行！E━E  └── pairing.ts           ↁEDM 陌生人配对码流程！E200 行！E├── cron/
━E  └── service.ts           ↁEcron 表达式解极E+ 定时触发！E300 行！E└── ui/
    └── index.html           ↁEWeb 控制台�E�E500 行，单斁E���E�含 JS�E�E
配置与辁E��斁E���E�不计入"功�E代码E�E�！E  package.json, tsconfig.json, Dockerfile
  .env.example
  soul.md.example            ↁE示侁Esoul.md�E�供用户参老E```

**行数汁E���E�E*

| 模坁E| 行数 |
|------|------|
| 入口 / 配置 | 250 |
| Gateway�E�ETTP/WS/Auth�E�E| 350 |
| 渠道！Eelegram + 飞书�E�E| 1,400 |
| Agent�E�Eunner + Context + Tools�E�E| 1,300 |
| Memory�E�Etore + Search + Consolidate + Weekly�E�E| 750 |
| Session�E�Etore + Routing�E�E| 400 |
| Security�E�Ellowlist + Pairing�E�E| 300 |
| Cron | 300 |
| Web UI | 500 |
| **合计** | **~5,550 衁E* |

加上类型定义文件�E�Etypes.ts` 等，约 300 行）和测试文件�E�单允E��试，约 600 行）！E*总计约 6,500 衁E*、E
---

## 九、总绁E
| | OpenClaw | SoulClaw |
|--|----------|---------|
| 代码E�� | ~128,000 衁E| ~6,500 行！E*约 5%**�E�E|
| 渠道支持E| 22+ | 2�E�飞书、Telegram�E�E|
| AI provider | 8+ | 2�E�Enthropic、OpenAI�E�E|
| System prompt | 桁E��强制注入�E�用户要E��困难 | **默认为空�E�soul.md 完�E掌控** |
| 记忁E| 可选插件�E�重依赖，黑盒 | **冁E���E�Markdown 斁E���E�透�E可编辁E* |
| 记忁E��"感见E | 数据库检索 | **像在回忁E��短朁E长朁E遗忘！E* |
| 配置 | JSON5 + secretref + binding + provider 抽象 | JSON + 环墁E��量，看名字就懁E|
| 部署 | Docker�E�memory 插件开启时需要E��外原生依赁E| `node src/main.ts` 或一衁EDocker�E�零额外依赁E|
| 适合场景 | 开源产品E��面向社区�E�多渠遁E| **个人/小团队�E用�E�够用就好** |

**核忁E��舁E*�E�OpenClaw 是设计给�E世界用皁E��品E��插件系统、抽象层、生戁Eschema、绁E��度杁E��控制都是忁E��的——对宁E��定位而言、EinGate 是为自己造皁E��具�E�代码复杂度和实际需求精确匹配，没有多余的一行、E
---

*如需开始�E代码E��建议仁E`src/channels/telegram.ts` 咁E`src/agent/runner.ts` 入手，这两个斁E��定义亁E��统最核忁E��两条数据流、E
