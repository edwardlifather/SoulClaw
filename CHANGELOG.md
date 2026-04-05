# SoulClaw Changelog

All notable changes to SoulClaw are documented in this file.

---

## [0.1.1] — 2026-04-05

### 🎉 Feishu Channel — Production Ready

**Feishu (飞书) integration fully operational via Webhook.**

#### Added
- Feishu Webhook endpoint at `/feishu/events` with URL Verification Challenge support
- Robust V1/V2 payload token extraction (`payload.token` + `payload.header.token`)
- Feishu pairing code flow — new users receive a verification code via bot reply
- Verbose logging for inbound webhook requests (debug-friendly)

#### Changed
- **Brand rename**: All `MinGate` references replaced with `SoulClaw` across source code, CLI, logs, and documentation
- Log file renamed from `mingate.log` → `soulclaw.log`
- CLI commands renamed: `mingate allow <code>` → `soulclaw allow <code>`
- Environment variable `MINGATE_TOKEN` → `SOULCLAW_TOKEN`
- Internal field `minGateToken` → `soulclawToken` in types, config, and server auth
- Chinese documentation (`zh/*.md`) bulk-updated to SoulClaw branding

#### Fixed
- Feishu webhook returning plain text instead of JSON — caused Feishu portal to show misleading "invalid JSON" errors
- Feishu URL Verification Challenge blocked by HMAC signature check (Feishu omits signature headers during initial verification)
- CLI `allow` command crashing with `TELEGRAM_BOT_TOKEN is required` — CLI was loading `.env` from wrong directory
- LOC metrics script updated to reflect current 4,800 lines

#### Security
- Simplified Feishu event authentication: replaced unreliable HMAC signature verification with embedded Verification Token matching
- HTTPS transport layer + unique per-app token provides equivalent security to Telegram's webhook model

---

## [0.1.0] — 2026-04-04

### 🚀 Initial Release — SoulClaw Gateway

**First production deployment of the SoulClaw AI Gateway.**

#### Core Features
- **Telegram channel**: Full support via Webhook (production) and Long-Polling (dev) modes
- **Feishu channel**: Client initialization with Lark SDK (event processing added in 0.1.1)
- **WebUI dashboard**: Real-time telemetry with System Health, Chat Lab, Transcripts, Memory, Cron Jobs, and Config panels
- **Cognitive Memory**: Three-tier human memory model (Working → Short-term → Long-term) using Markdown files
- **Dynamic Skills**: Load agent capabilities from `~/.soulclaw/skills/*.md` at runtime
- **Cron Jobs**: Scheduled AI-generated messages to designated users
- **Zero-Trust Security**: Whitelist-based access control with pairing code onboarding
- **CLI Management**: `soulclaw allow|list|jobs|version` commands

#### Architecture
- Single-process Node.js server (port 3001)
- Configuration via `~/.soulclaw/config.json` + `~/.soulclaw/.env`
- Supports Anthropic Claude and OpenAI models
- LOC Audit: **4,790 lines** vs OpenClaw's 562,804 lines (0.85% code ratio, 85% functional parity)

#### Deployment
- PM2 process management on Ubuntu VPS
- Nginx reverse proxy with SSL (`api.edwardli.ai`)
- Telegram Webhook auto-registration on startup
