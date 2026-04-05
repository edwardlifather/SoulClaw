# SoulClaw Architecture

SoulClaw is a minimalist, high-performance AI gateway designed as a lean successor to the OpenClaw concept. It bridges messaging channels (Telegram, Feishu/Lark) with advanced Large Language Models (LLMs) while maintaining persistent memory and tool-execution capabilities.

## 核心架构 (Core Architecture)

The system is built on four functional pillars:

### 1. Unified Gateway (统一网关)
SoulClaw provides a standardized REST API and specialized channel adapters.
- **Entry Points**: `src/gateway/server.ts` handles HTTP/WebUI requests.
- **Adapters**: `src/channels/` maps Telegram/Feishu messages into a unified `InboundMessage` format.

### 2. Autonomous Runner (自主运行引擎)
The "Brain" of the system, located in `src/agent/runner.ts`.
- **Logic**: Implements the agentic loop (Reasoning -> Tool Use).
- **Flexibility**: Supports both OpenAI and Anthropic API protocols out of the box.
- **Streaming**: Provides real-time "Typewriter" feedback for all messaging channels.

### 3. Progressive Memory (阶梯式记忆)
SoulClaw doesn't just chat; it evolves.
- **Short-Term (Ephemeral)**: Logs recent chat history for immediate context.
- **Long-Term (Persistent)**: Fact-based storage in `memory.md`, managed by an AI consolidation process (`src/memory/consolidate.ts`).
- **Semantic Refinement**: AI-driven merging logic protects against conflicting facts (e.g., age updates).

### 4. Expansion Tools (扩展工具箱)
The "Claws" of the system, found in `src/agent/tools/`.
- **FS**: Full filesystem browsing, reading, and writing.
- **Shell**: Direct terminal command execution.
- **HTTP**: Public web content fetching.

## Project Structure

```text
SoulClaw/
├── src/
│   ├── agent/        # Core AI logic & tool management
│   ├── channels/     # Telegram, Feishu, and future adapters
│   ├── gateway/      # Web management server & API
│   ├── memory/       # Knowledge consolidation & persistent storage
│   ├── session/      # Transcript management & state persistence
│   └── types.ts      # Unified system type definitions
├── ui/               # Minimalist English Management Console
└── SoulClaw-docs/    # Multilingual documentation
```

## Security & Access
Access is strictly managed via `config.json`'s `allowFrom` whitelist and `MINGATE_TOKEN` environment variables, ensuring that your local SoulClaw remains your private cognitive asset.
