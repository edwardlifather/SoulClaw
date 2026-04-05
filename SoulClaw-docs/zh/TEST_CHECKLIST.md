# MinGate E2E 测试检查表

本检查表基于 `MinGate` 端到端测试场景，将每一条场景拆解为“测试步骤 + 预期结果”。适用于手工验证或测试执行记录。

> 注意：部分行为（如 memory_search 触发、模型工具调用、thinking 模式、日志输出）依赖模型返回和运行时决策，测试时应关注是否支持该行为，而不是期望每次都出现。

## 1. 安装与启动场景（1-15）

1. 步骤：创建空目录，写入有效 `config.json` 和 `.env`。执行 `npm install`、`npm run build`、`npm start`。
   预期结果：服务成功启动，控制台输出包含 `MinGate ready`，监听 `config.port`。

2. 步骤：删除或重命名 `config.json`，执行 `npm start`。
   预期结果：启动失败，错误日志包含 `Config file not found`。

3. 步骤：将 `config.json` 中的 `model` 段删除，执行 `npm start`。
   预期结果：启动失败，错误日志包含 `"model" section is required`。

4. 步骤：使用有效 `config.json` 与 `.env`，启动服务后访问 `http://localhost:{port}/healthz`。
   预期结果：返回 HTTP 200，响应 body 包含 `"status":"ok"`。

5. 步骤：配置 `telegram` 但在 `.env` 中省略 `TELEGRAM_BOT_TOKEN`，启动服务。
   预期结果：启动失败，错误提示缺少 `TELEGRAM_BOT_TOKEN`。

6. 步骤：配置 `feishu` 但在 `.env` 中省略 `FEISHU_APP_SECRET` 或 `FEISHU_VERIFICATION_TOKEN`，启动服务。
   预期结果：启动失败，错误提示缺少相应 Feishu 环境变量。

7. 步骤：设置 `MINGATE_DATA_DIR` 指向一个临时目录，启动服务。
   预期结果：临时目录创建成功，目录结构包含 `memory/`、`sessions/`，并能启动。

8. 步骤：删除 `soul.md`，启动服务，发送一条渠道消息。
   预期结果：服务启动正常，消息处理不包含用户自定义 System Prompt，仅可能包含渠道上下文。

9. 步骤：在数据目录创建 `soul.md` 并写入 `你是我的私人助理`，重启服务，发送测试消息。
   预期结果：系统 prompt 中包含 `你是我的私人助理`，后端调用模型时将其注入。

10. 步骤：将 `config.addChannelContext` 设为 `false`，启动服务，发送消息。
    预期结果：系统 prompt 只包含 `soul.md` 内容，不包含渠道上下文注入。

11. 步骤：在 Windows 上运行 `npm start`，然后在浏览器或 curl 访问服务端口。
    预期结果：服务可达，HTTP 请求返回正常响应，端口绑定成功。

12. 步骤：将 `config.telegram.webhookPath` 改为 `/tg-hook`，启动服务，以该路径发送模拟 webhook 请求。
    预期结果：请求由 Telegram webhook 处理逻辑接收，返回 200 或等价成功响应。

13. 步骤：将 `config.feishu.webhookPath` 改为 `/feishu-hook`，启动服务，以该路径发送模拟 Feishu 回调请求。
    预期结果：请求由 Feishu webhook 处理逻辑接收，返回 200 或等价成功响应。

14. 步骤：启动服务后访问 `/` 和 `/ui`。
    预期结果：返回 Web 控制台 HTML 页面，而非 404 或错误。

15. 步骤：故意配置错误 `auth` 或 `config` 参数，启动服务。
    预期结果：服务退出，控制台或日志输出明确错误信息，便于定位配置问题。

## 2. 配置与环境流程（16-30）

16. 步骤：使用 `MINGATE_DATA_DIR` 启动，确认目录存在；创建 `soul.md`，重启服务。
    预期结果：服务重启后读取新创建的 `soul.md` 并生效。

17. 步骤：在 `config.json` 中添加一个有效 `cron.jobs`，重启服务，访问 `/api/config`。
    预期结果：返回的配置中包含新增的 cron job 信息。

18. 步骤：将 `config.memory.enabled` 设为 `false`，启动服务。
    预期结果：服务启动成功，但 `/api/health` 或内部日志中不再注册 `__weekly_memory__` 任务。

19. 步骤：在 `config.json` 配置 `telegram.allowFrom`，重启服务，并用不在白名单内的 Telegram 用户发送消息。
    预期结果：消息不触发模型调用，而是进入 pairing code 流程；白名单用户则可正常交互。

20. 步骤：在 `config.json` 配置 `feishu.allowFrom`，重启服务，并用不在白名单内的 Feishu 用户发送 DM。
    预期结果：消息不触发模型调用，而是进入 pairing code 流程；白名单用户则可正常交互。

21. 步骤：将 `config.cron.jobs[0].deliverTo.channel` 设为非法值，启动服务。
    预期结果：启动失败，错误提示 `deliverTo.channel` 非法。

22. 步骤：将 `config.model.thinking` 设为 `true`，启动服务，并发送一条消息触发模型调用。
    预期结果：模型请求包含 thinking 配置，且服务仍正常处理请求。

23. 步骤：设置 `config.memory.shortTermDays` 为 3，生成超过 3 天的短期记忆文件后执行 weekly consolidation。
    预期结果：超过 3 天的 short_term 文件在 consolidation 之后被清理。

24. 步骤：将 `config.memory.consolidateIdleMinutes` 调小，发送一条消息后保持空闲状态。
    预期结果：短期记忆整合逻辑更快触发，相关日志或行为可观察到。

25. 步骤：将 `telegram.webhookPath` 改为 `/tg-hook`，启动服务后通过新的路径发送 Telegram webhook。
    预期结果：请求正常路由，服务接受并处理 Telegram webhook。

26. 步骤：将 `feishu.webhookPath` 改为 `/feishu-hook`，启动服务后通过新的路径发送 Feishu webhook。
    预期结果：请求正常路由，服务接受并处理 Feishu 回调。

27. 步骤：删除 `soul.md` 并重启服务，发送测试消息。
    预期结果：系统 prompt 不包含个性化内容，仅包含渠道上下文或为空。

28. 步骤：运行时修改 `config.json` 中 `allowFrom`，重启服务后发送一条新消息。
    预期结果：新的 allowFrom 规则生效，未授权用户被拒绝或进入 pairing 流程，授予用户可正常交互。

29. 步骤：在 `.env` 中不设置 `TELEGRAM_PUBLIC_URL`，启动 Telegram 通道。
    预期结果：服务输出 long-polling 警告信息并尝试启动长轮询模式。

30. 步骤：同时配置 `telegram` 和 `feishu`，启动服务，访问 `/api/health`。
    预期结果：返回中包含两个渠道的健康状态对象。

## 3. Telegram 端到端流程（31-50）

31. 步骤：用新 Telegram 用户私信机器人，且其 `peerId` 不在 `telegram.allowFrom` 中。
    预期结果：机器人发送 pairing code，数据目录生成 pairing 记录，并不调用模型。

32. 步骤：同一 Telegram 用户在 pairing code 有效期内再次私信。
    预期结果：机器人不生成新的 pairing code，仍返回同一或不重复 pairing 过程信息。

33. 步骤：管理员在 CLI 运行 `mingate allow <code>`。
    预期结果：`telegram.allowFrom` 包含该用户 `peerId`，CLI 输出成功消息。

34. 步骤：批准用户后再次私信机器人，发送一个普通问句。
    预期结果：服务调用模型并发送文本回复给用户。

35. 步骤：在 Telegram 群组中发送一条未 @ 机器人的消息。
    预期结果：机器人忽略该消息，不触发模型调用。

36. 步骤：在 Telegram 群组中 @ 机器人并发送消息。
    预期结果：机器人识别提及，触发模型调用并返回答复。

37. 步骤：在 Telegram 私信或群组中发送带图片的消息。
    预期结果：服务下载图片并将 Base64 数据传入模型；如果不能下载，会记录警告但不崩溃。

38. 步骤：让机器人回复一条超过 4096 字符的文本。
    预期结果：机器人将回复拆分为多条消息发送，且用户最终收到完整内容。

39. 步骤：发送模拟 Telegram webhook 请求，携带错误的 `x-telegram-bot-api-secret-token`。
    预期结果：服务返回 HTTP 401，拒绝处理请求。

40. 步骤：发送合法的 Telegram webhook 请求，触发消息处理。
    预期结果：消息成功写入 `sessions/{key}/transcript.jsonl`，`metadata.json` 更新。

41. 步骤：在 Telegram DM 中向机器人提问，例如“你记得我之前说的偏好吗？”。
    预期结果：若模型决策使用 memory_search 工具，回复中应包含长期记忆相关内容；即便未触发 memory_search，机器人仍应返回合理文本答案。

42. 步骤：在 Telegram 群里对 bot 的消息进行 reply-to 操作并发送。
    预期结果：机器人能识别并处理 reply-to 消息，回复正确发送。

43. 步骤：向机器人连续发送大量消息，累积足够多的 transcript。
    预期结果：系统裁剪旧 transcript，保留近期消息，并继续处理最新请求。

44. 步骤：Telegram 用户发送 pairing code 但管理员尚未批准，继续发送普通消息。
    预期结果：机器人仍不处理普通消息，等待批准或 pairing 流程完成。

45. 步骤：在 Telegram 私信中发送“帮助”或其他普通询问。
    预期结果：模型返回的文本被作为机器人回复发送给用户。

46. 步骤：在 Telegram 私信中使用一个已经在 `allowFrom` 的用户身份发送消息。
    预期结果：机器人正常响应，不再要求 pairing。

47. 步骤：在 Telegram 群组中发送包含用户名替换或 reply 的消息。
    预期结果：会话存储正常，消息格式不会导致 transcript 存储异常。

48. 步骤：发送 Telegram 文件或其他非文本消息。
    预期结果：服务不会崩溃，如果处理失败则记录异常并继续运行。

49. 步骤：重启机器人服务后，查询之前 Telegram 会话的 transcript。
    预期结果：历史记录存在，后续会话可继续引用上下文。

50. 步骤：用不在白名单内的 Telegram 用户再次发送消息。
    预期结果：机器人不调用模型，只返回 pairing code 流程响应。

## 4. 飞书端到端流程（51-70）

51. 步骤：用新 Feishu 用户私信应用，且该用户不在 `feishu.allowFrom` 中。
    预期结果：应用发送 pairing code，生成 pairing 记录，并不调用模型。

52. 步骤：在 pairing code 有效期内再次由同一 Feishu 用户私信。
    预期结果：不生成新的 pairing code，保持旧 pairing 记录。

53. 步骤：管理员通过 CLI 执行 `mingate allow <code>`。
    预期结果：用户 `open_id` 加入 `feishu.allowFrom`，CLI 显示成功。

54. 步骤：批准后 Feishu 用户发送一条普通消息。
    预期结果：服务调用模型并回复文本给用户。

55. 步骤：在 Feishu 群组中发送未 @ 应用的消息。
    预期结果：应用忽略消息，不触发后端处理。

56. 步骤：在 Feishu 群组中 @ 应用并发送消息。
    预期结果：消息被清洗，正确传入模型并产生回复。

57. 步骤：发送合法 Feishu 消息 webhook，带正确 HMAC 签名。
    预期结果：请求验证通过，消息被处理。

58. 步骤：发送 Feishu `url_verification` 事件。
    预期结果：服务返回 challenge JSON，验证 webhook 初始化成功。

59. 步骤：发送 Feishu 图片消息并检查处理结果。
    预期结果：服务尝试下载图片并将 Base64 转入模型；若下载失败，则记录警告但不崩溃。

60. 步骤：发送 Feishu 消息后调用 `/api/sessions`。
    预期结果：返回包含该 Feishu 会话 metadata 的列表项。

61. 步骤：用未授权 Feishu 用户私信应用。
    预期结果：触发 pairing code 流程，不执行模型调用。

62. 步骤：在 Feishu 群组内发送含 `@bot` 的消息。
    预期结果：应用识别 mention 并处理为有效请求。

63. 步骤：发送合法 Feishu webhook 后端立即返回 200，之后再观察服务是否异步处理消息。
    预期结果：webhook 响应迅速，后端继续处理并回复用户。

64. 步骤：发送无效 JSON 的 Feishu 回调请求。
    预期结果：服务返回 HTTP 400，并记录解析错误。

65. 步骤：在 Feishu 会话中发送消息，观察 `touchSession` 是否被触发。
    预期结果：生成或更新会话 metadata，并为空闲记忆整理计时。

66. 步骤：重启服务后查询 Feishu 会话历史。
    预期结果：历史 transcript 保留，后续会话可继续上下文。

67. 步骤：发送 Feishu 群消息，其 mentions 列表无法正确识别 bot。
    预期结果：服务不误触发回复。

68. 步骤：测试 Feishu image download 失败场景。
    预期结果：服务记录警告并继续处理其他内容。

69. 步骤：未配置 `FEISHU_VERIFICATION_TOKEN` 的情况下发起 Feishu webhook。
    预期结果：返回 HTTP 503，提示 Feishu 未配置。

70. 步骤：配置完整后发起合法 Feishu webhook。
    预期结果：返回 HTTP 200，后端异步处理消息。

## 5. 会话与记忆流程（71-85）

71. 步骤：发送第一条用户消息，检查 `sessions/{key}/transcript.jsonl`。
    预期结果：文件中记录 user 条目和 assistant 条目（若有回复）。

72. 步骤：多次发送消息后检查 `metadata.json`。
    预期结果：`messageCount` 递增，`lastActiveAt` 更新为最新时间。

73. 步骤：构造大量消息使 transcript 超出上下文预算。
    预期结果：老旧条目在模型调用前被裁剪，最近消息仍保留。

74. 步骤：用一个与记忆相关的问题触发模型。
    预期结果：服务调用 memory_search 工具并可能返回长期记忆内容。

75. 步骤：让会话保持空闲超过 `consolidateIdleMinutes`，触发短期记忆保存。
    预期结果：`memory/short_term/{date}.md` 中追加摘要条目。

76. 步骤：同日多次会话后检查同一 short_term 文件。
    预期结果：条目按时间顺序追加，不覆盖之前内容。

77. 步骤：手动触发或等待 weekly consolidation 任务。
    预期结果：读取最近 7 天摘要并将重要内容保存到长期记忆。

78. 步骤：检查 `memory/long_term/facts.md` 和 `preferences.md`。
    预期结果：长期记忆文件中存在由 memory_save 工具写入的条目。

79. 步骤：多次保存相似记忆内容。
    预期结果：系统检测重复，更新已有条目而非新增重复条目。

80. 步骤：执行 memory_search 查询关键词。
    预期结果：返回最匹配条目，且该条目的 `accessCount` 应该增加。

81. 步骤：在消息中询问“你记得我吗？”或类似语句。
    预期结果：机器人能够从长期记忆中检索用户事实并生成相应回答。

82. 步骤：分别在 Telegram 与 Feishu 发送同样的问题。
    预期结果：两个渠道会话独立保存，不共享 transcript。

83. 步骤：同一天内在 Telegram 与 Feishu 都与机器人对话。
    预期结果：短期记忆文件按日期汇总，反映多渠道对话。

84. 步骤：模拟 memory store 读写异常（如权限错误）。
    预期结果：异常被记录，主服务继续运行，不发生崩溃。

85. 步骤：创建超过 `shortTermDays` 的 old short_term 文件并执行清理。
    预期结果：旧文件被删除，不再出现在 `/api/memory/short`。

## 6. Web 控制台与 API 流程（86-95）

86. 步骤：启动服务后在浏览器访问根路径，打开 Web 控制台，并尝试连接 `/ws`。
    预期结果：页面加载成功，WebSocket 连接建立。

87. 步骤：调用 `/api/health`，发送正确 Bearer token。
    预期结果：返回渠道健康状态列表。

88. 步骤：调用 `/api/config`，发送正确 Bearer token。
    预期结果：返回配置摘要，不包含敏感 API 密钥。

89. 步骤：调用 `/api/sessions`。
    预期结果：返回活跃会话列表，包含 `key`、`peerId`、`lastActiveAt` 等 metadata。

90. 步骤：调用 `/api/sessions/{key}/transcript?limit=10&offset=0`。
    预期结果：返回指定会话的 transcript 条目。

91. 步骤：调用 `/api/memory/short`。
    预期结果：返回可用短期记忆日期列表。

92. 步骤：调用 `/api/memory/short/{date}`。
    预期结果：返回该日期的 short_term 文件内容。

93. 步骤：调用 `/api/memory/long/facts`。
    预期结果：返回长期事实内容；若文件不存在，content 为空字符串。

94. 步骤：调用 `/api/memory/long/preferences`。
    预期结果：返回长期偏好内容；若文件不存在，content 为空字符串。

95. 步骤：调用任意 API 接口，使用错误或缺失 Bearer token。
    预期结果：返回 HTTP 401，响应体说明授权失败。

## 7. 定时任务与后台流程（96-100）

96. 步骤：配置一个 cron job，启动服务并等待定时触发。
    预期结果：job 在预定时间执行并向指定 `deliverTo` 发送消息。

97. 步骤：调用 `runJobNow()`（通过代码或 API 调用）执行指定任务。
    预期结果：任务立即执行，并发送消息给 Telegram 或 Feishu `peerId`。

98. 步骤：调用 `setJobEnabled(jobId, false)`，等待调度周期。
    预期结果：该 job 不再触发执行。

99. 步骤：调用 `setJobEnabled(jobId, true)`，等待调度周期。
    预期结果：该 job 恢复调度并再次触发执行。

100. 步骤：确认 `memory.enabled=true` 并启动服务，观察每周 `__weekly_memory__` 任务是否注册。
     预期结果：任务在成功执行后清理超过 `shortTermDays` 的短期记忆文件。
