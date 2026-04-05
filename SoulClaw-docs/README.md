# SoulClaw

[English] | [简体中文](./zh/00-design.md)

**SoulClaw** is a minimalist, agentic AI gateway that centralizes Large Language Models (OpenAI, Anthropic, DeepSeek, Zhipu/GLM) into unified communication channels. Reimagined from the **OpenClaw** architecture, it's a high-performance cognitive assistant for single-users and organizations.

## Key Features

- **🚀 Real-time Streaming**: Typewriter-style live replies in Telegram and Web Management UI.
- **🧠 Evolving Memory**: Automated long-term memory consolidation with fact-conflict resolution.
- **🛠️ Power Tools**: Full access to FileSystem, Shell command execution, and HTTP URL fetching.
- **🔗 Hybrid Networking**: Seamlessly switch between Webhook and Polling modes.
- **📜 Transparency**: In-depth Token usage tracking and raw API JSON visibility for debugging.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env` and `config.json` in the project root or `~/.soulclaw/`.
3. Start the engine:
   ```bash
   npm run dev
   ```

## Documentation

- [Release History](./CHANGELOG.md)
- [English Design Whitepaper](./DESIGN-EN.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [Configuration Guide](./CONFIG.md)
- [API Reference](./API.md)
- [简体中文设计稿](./zh/00-design.md)

---
© 2026 Zhipeng Li. All Rights Reserved.
Based on OpenClaw's Architectural Concepts.
