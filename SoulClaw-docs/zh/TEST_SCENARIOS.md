# MinGate 端到端测试场景

本测试书聚焦 MinGate 的 E2E 流程，覆盖用户从安装、配置、渠道接入、消息交互、记忆管理、Web UI/API、定时任务、配对授权到运维 shutdown 的实际操作流程。

## 1. 安装与启动场景（1-15）

1. 在全新工作目录中准备 `config.json` 和 `.env` 后，执行 `npm install`、`npm run build`、`npm start`，确认服务成功监听 `config.port` 并输出“MinGate ready”。
2. 遗失 `config.json` 时启动失败，日志中显示“Config file not found”。
3. `config.json` 中缺少 `model` 配置时启动失败，日志显示 `"model" section is required`。
4. `config.json` 示例正确，`MODEL_API_KEY` 有效，启动后 `http://localhost:{port}/healthz` 返回 HTTP 200。
5. `config.json` 中配置 Telegram，但 `.env` 未提供 `TELEGRAM_BOT_TOKEN`，服务启动失败并提示缺少令牌。
6. `config.json` 中配置 Feishu，但 `.env` 缺少 `FEISHU_APP_SECRET` 或 `FEISHU_VERIFICATION_TOKEN`，服务启动失败并提示缺失环境变量。
7. 使用 `MINGATE_DATA_DIR` 指定数据目录，启动后应在数据目录下创建 `memory`、`sessions` 等目录结构。
8. `soul.md` 不存在时启动成功，后续从渠道进入的消息仅带渠道上下文，不带自定义个性化提示。
9. `soul.md` 存在且内容为“你是我的私人助理”，启动后发送消息时生成的 system prompt 包含该文本。
10. 设置 `config.addChannelContext=false` 后，启动并发送消息，服务不再将渠道上下文注入到 system prompt 中。
11. 在 Windows 环境下运行 `npm start`，服务正确绑定端口并能够接受 HTTP 请求。
12. 启动后如果 `config.telegram.webhookPath` 不同于默认值，`/telegram/webhook` 以外的路径仍能接收 Telegram webhook。
13. 启动后如果 `config.feishu.webhookPath` 更改，`/feishu/events` 以外的路径仍能处理 Feishu 回调。
14. 服务启动后立即访问 `/` 或 `/ui`，返回 Web 控制台 HTML 页面。
15. 在启动时发生 `auth` 或 `config` 报错，服务退出并输出明确错误，便于运维定位。

## 2. 配置与环境流程（16-30）

16. 使用 `MINGATE_DATA_DIR` 启动并验证该目录存在，然后在该目录创建 `soul.md` 并再次重启，确认生效。
17. 编辑 `config.json` 添加 `cron.jobs`，重启后 Web UI 的 API `/api/config` 返回该定时任务配置。
18. 将 `config.memory.enabled` 设为 `false`，启动后服务仍能运行，但不注册每周记忆整合任务。
19. 在 `config.json` 中配置了 `telegram.allowFrom`，启动后该白名单能够限制 Telegram 消息接收。
20. 在 `config.json` 中配置了 `feishu.allowFrom`，启动后该白名单能够限制 Feishu 消息接收。
21. 使用无效 `config.cron.jobs[0].deliverTo.channel` 时，启动失败并返回配置验证错误。
22. 将 `config.model.thinking` 从 `false` 切换为 `true`，启动后服务应启用模型 thinking 模式并调整请求参数。
23. `config.memory.shortTermDays` 设为 3，后续记忆清理应删除超过 3 天的短期记忆文件。
24. `config.memory.consolidateIdleMinutes` 调整为较小值，触发会话空闲整理逻辑时应更快触发短期记忆保存。
25. 在 `config.json` 里将 `telegram.webhookPath` 改为 `/tg-hook`，部署后 Telegram webhook 请求仍能正确路由。
26. 在 `config.json` 里将 `feishu.webhookPath` 改为 `/feishu-hook`，部署后 Feishu webhook 请求仍能正确路由。
27. 启动时无 `soul.md`，后续用户消息不会被个性化 prompt 影响，确认与设计一致。
28. 运行时修改 `config.json` 中 `allowFrom`，CLI 不重启但从下一次消息开始，新的白名单策略生效。
29. 启动时 `TELEGRAM_PUBLIC_URL` 未设置，服务进入 long-polling 模式并输出警告信息。
30. 启动时 `telegram` 和 `feishu` 均配置，服务同时初始化两个渠道且在 `/api/health` 返回两个渠道状态。

## 3. Telegram 端到端流程（31-50）

31. 新 Telegram 用户私信机器人且不在 `allowFrom` 中，机器人自动发送 pairing code，并在数据目录生成 pairing 记录。
32. 同一 Telegram 用户再次私信机器人时，如果 pairing code 未过期，不会生成新的 pairing code。
33. 管理员使用 `mingate allow <code>` 批准 pairing code，用户 `peerId` 被追加到 `telegram.allowFrom`。
34. 已批准用户私信机器人发送问题时，机器人调用模型并回复文本消息给用户。
35. Telegram 群组中未 @ 机器人的消息被忽略，不触发模型调用。
36. Telegram 群组中 @ 机器人的消息被识别为提及，触发模型调用并返回答复。
37. Telegram 消息包含图片时，机器人下载图片内容并将 Base64 传入模型进行处理。
38. Telegram 回复消息超过 4096 字符时，机器人自动切分为多条消息发送。
39. 当 Telegram webhook 请求的 `x-telegram-bot-api-secret-token` 不匹配时，服务返回 401 并拒绝处理。
40. Telegram webhook 成功接收消息后，服务将消息写入对应会话 transcript，并更新会话 metadata。
41. 在 Telegram DM 中，机器人对用户发送的“记忆”类问题，运行记忆检索工具后将相关条目拼接并返回。
42. Telegram 群组中，如果消息为 reply-to bot 消息，机器人仍能识别并处理。
43. Telegram bot 接收大量连续消息时，服务按照模型上下文预算裁剪旧 transcript 并处理最新消息。
44. Telegram 用户发送 pairing code 但未管理员批准，机器人仍不处理后续普通消息。
45. Telegram 用户发送文本 “帮助” 时，若模型返回文本，机器人将其作为普通回复发送出去。
46. Telegram private chat 的允许用户与配置白名单中用户一致，机器人正常响应。
47. Telegram 群组消息中的用户名替换与 reply 逻辑不会影响实际会话存储。
48. 机器人在 Telegram 收到文件时不会崩溃，并记录事件为可观测异常。
49. Telegram 会话中断（机器人重启）后，历史 transcript 能继续被读取并继续上下文。
50. Telegram 发送未被 allowlist 允许的用户消息时，机器人不会调用模型，只触发 pairing code 流程。

## 4. 飞书端到端流程（51-70）

51. 新 Feishu 用户私信应用且不在 `allowFrom` 中，应用发送 pairing code 并保存 pairing 记录。
52. 同一 Feishu 用户再次私信时，如果 pairing code 未过期，不会重复生成新的 pairing code。
53. 管理员通过 CLI 批准 Feishu pairing code，`allowFrom` 列表更新后用户进入白名单。
54. 已批准 Feishu DM 用户发送消息后，应用调用模型并回复文本。
55. Feishu 群组消息中未 @ 应用时，消息被忽略，不触发后端处理。
56. Feishu 群组消息中 @ 应用时，内容被清洗并正确传入模型。
57. Feishu 文本消息经 HMAC 验证成功后被处理；签名错误时返回 401。
58. Feishu `url_verification` 事件返回 challenge 成功，确认 webhook 初始化流程正常。
59. Feishu 场景下应用接收图片消息时，尝试下载并传递 Base64 数据给模型。
60. Feishu 应用在接收消息后记录 session metadata，并可通过 `/api/sessions` 查询。
61. Feishu 私信若用户不在白名单，触发 pairing code 流程而不执行模型调用。
62. Feishu 私信中含有 `@bot` 语法的群消息，处理后机回复与私信一致。
63. Feishu webhook 成功响应后，后端继续异步处理，确保回复不阻塞 webhook 返回。
64. Feishu 收到 invalid JSON payload 时返回 400，并记录错误。
65. Feishu 用户发送消息后，`touchSession` 触发空闲记忆 consolidation 计时逻辑。
66. Feishu 会话历史跨服务重启后仍可查询，并继续当前会话上下文。
67. Feishu 群消息中 `mentions` 识别失败时，服务不会误触发回复。
68. 当 Feishu `download image` 失败时，服务记录警告但继续处理文本内容。
69. Feishu webhook 在未配置 `FEISHU_VERIFICATION_TOKEN` 时返回 503，表示缺少配置。
70. Feishu webhook 在已配置情况下，对合法事件返回 HTTP 200 并异步处理。

## 5. 会话与记忆流程（71-85）

71. 用户发送第一条消息后，服务在 `sessions/{key}/transcript.jsonl` 中记录 user 和 assistant 条目。
72. 同一会话中的多条消息，`metadata.json` 中 `messageCount` 与 `lastActiveAt` 持续更新。
73. 会话 transcript 超出模型上下文预算时，旧消息被裁剪，且最新消息仍被保留处理。
74. 用户对机器人提问后，模型触发 `memory_search` 工具，返回相关长期记忆结果并用于回答。
75. 机器人在会话末尾空闲时触发短期记忆保存，将摘要追加到 `memory/short_term/{date}.md`。
76. 多次会话产生的短期记忆文件在同一天中按顺序追加，不丢失之前内容。
77. 周期性执行 `weekly` 记忆整合时，读取最近 7 天短期摘要并生成长期记忆条目。
78. `memory/long_term/facts.md` 与 `preferences.md` 正确保存经工具调用写入的条目。
79. 长期记忆条目重复保存时，系统应检测相似度并更新原条目而不是新增重复项。
80. `memory_search` 对给定关键词返回最匹配的长期记忆条目，并提升该条目的 `accessCount`。
81. 用户在消息中提到“你记得我吗？”时，系统能够通过长期记忆找到用户事实并回答。
82. 会话在不同渠道中分别保存，Telegram 与 Feishu 不共享同一 transcript。
83. 用户在同一天从 Telegram 私信和 Feishu 私信分别与机器人对话，短期记忆文件仍按日期汇总。
84. 记忆整合任务在内存与磁盘异常时失败应被记录，但不影响主服务继续运行。
85. `memory/short_term` 中旧文件超过 `shortTermDays` 时，定期被清理，不再出现在 `/api/memory/short` 列表中。

## 6. Web 控制台与 API 流程（86-95）

86. 启动后访问 Web 控制台根路径加载 HTML，且页面可连接到 WebSocket `/ws`。
87. `/api/health` 通过 Bearer token 授权后返回渠道健康状态列表。
88. `/api/config` 通过 Bearer token 返回非敏感配置摘要，不泄露 API 密钥。
89. `/api/sessions` 返回所有活跃会话的 metadata，包括 `key`、`peerId`、`lastActiveAt`。
90. `/api/sessions/{key}/transcript` 按 limit/offset 分页返回指定会话 transcript。
91. `/api/memory/short` 返回可用的短期记忆日期列表。
92. `/api/memory/short/{date}` 返回指定短期记忆文件内容。
93. `/api/memory/long/facts` 可读取长期事实文件内容，若文件不存在返回空字符串。
94. `/api/memory/long/preferences` 可读取长期偏好文件内容，若文件不存在返回空字符串。
95. API 在 Bearer token 错误时返回 401，并在响应体中说明授权失败。

## 7. 定时任务与后台流程（96-100）

96. 服务启动后根据 `config.cron.jobs` 注册定时任务，并且在预期时间触发对指定 `deliverTo` 发送消息。
97. `runJobNow()` 被调用时，可立即执行指定 cron job，并向 Telegram 或 Feishu 相应 `peerId` 发送消息。
98. `setJobEnabled(jobId, false)` 暂停指定任务，后续调度不再触发该 job。
99. `setJobEnabled(jobId, true)` 恢复指定任务，使其重新参与调度。
100. 每周定时的 `__weekly_memory__` 任务在 `memory.enabled=true` 时注册，并在成功执行后清理超过 `shortTermDays` 的短期记忆文件。
