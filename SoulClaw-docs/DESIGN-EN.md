# SoulClaw: Minimalist Re-imagination Design Proposal

> **Philosophy**: A lean, single-user/small-team AI gateway. Re-engineered from the **OpenClaw** architecture with a target code reduction of **95%** (from ~128k lines down to ~6.5k lines), removing all non-essential abstractions while retaining professional-grade cognitive capabilities.

---

## I. Design Philosophy Comparison

| Dimension | OpenClaw | SoulClaw (The "Mini" Re-imagination) |
|-----------|----------|---------------------------------------|
| **Positioning** | Universal AI Gateway (22+ channels) | Private AI Agent (Feishu + Telegram) |
| **System Prompt** | Hundreds of lines of hardcoded instructions | **Empty by Default**; User-defined `soul.md` |
| **Memory** | Optional Plugin (Vector DB / Complex) | **Native Human Memory Model** (Built-in, File-based) |
| **Architecture** | Heavy plugin/interface abstraction | Direct channel implementation in `src/channels/` |
| **Configuration** | Complex JSON5 with Zod schemas | Simple JSON + Environment Variables |
| **Codebase Size** | 562,804 Lines | **Current 3,863 Lines** |

---

## II. System Prompt Strategy: The `soul.md` Concept

### The OpenClaw Way
OpenClaw injects a massive system prompt "tax" with every API call:
- Tool descriptions
- Safety warnings ("You are an AI, be good")
- Formatting constraints
- Channel metadata

### The SoulClaw Way
**Zero-hidden prompt policy.** The system prompt starts as an empty string. 
The user provides a `soul.md` in the config directory which defines the agent's persona:

```markdown
# ~/.soulclaw/soul.md Example
You are Alex, my specialized assistant.
Style: Direct, concise, occasionally witty.
Never explain that you are an AI.
```

The final prompt sent to the LLM follows a strict, transparent structure:
1. `[Contents of soul.md, if exists]`
2. `[One line of channel context, e.g., "Current chat from Telegram group 'Product Talk'"]`

**Tools are not part of the system prompt text**—they are passed via the native `tools` field in JSON Schema format, which models understand natively without extra explanation.

---

## III. The Progressive Human Memory Model

### 3.1 Why traditional Vector DBs fail the "Feeling" Test
OpenClaw's memory uses vector databases (SQLite-vec/LanceDB). The experience feels like **database retrieval**, not **recollection**. It retrieves facts based on similarity and injects them into the prompt, but it lacks the "weight" of time and importance.

### 3.2 The Three-Layer Memory Structure
SoulClaw implements a memory hierarchy inspired by human cognition, stored in plain Markdown files:

```text
~/.soulclaw/memory/
├── short_term/
│   └── {YYYY-MM-DD}.md    ← Daily summaries, auto-deleted after N days.
└── long_term/
    ├── facts.md           ← User facts (Name, Job, Habits).
    ├── preferences.md     ← User preferences (Writing style, Topics).
    └── projects/
        └── {name}.md      ← Project-specific context and progress.
```

### 3.3 Fine-Grained Memory Entries
`facts.md` and `preferences.md` are not monolithic texts. They are sequences of entries with metadata:

```markdown
<!-- entry: last_accessed=2026-03-28, access_count=7 -->
User is Zhang San, a Product Manager based in Beijing.

<!-- entry: last_accessed=2026-01-10, access_count=1 -->
User mentioned an interest in learning Rust.
```

### 3.4 The Forgetting Mechanism
Forgetting in SoulClaw isn't just deletion; it's a **decay in retrieval probability**:
- **Short-term**: Auto-deleted after a configurable period (default 14 days).
- **Long-term**: Entries with lower `access_count` or older `last_accessed` timestamps rank lower in search results, gradually fading out.

---

## IV. Core Toolset (The "Claws")

SoulClaw exposes a minimal but powerful set of tools to the agent:

1. **`memory_search(query)`**: Returns the most relevant Markdown snippets from long-term memory.
2. **`memory_save(content, type, project?)`**: 
   - Smart Update: If the new fact is highly similar to an existing one, it **overwrites** it (latest is best).
   - Category-based: Auto-routes to `facts.md`, `preferences.md`, or specific project files.
3. **`list_files` / `read_file` / `write_file`**: Direct environment interaction.
4. **`run_command`**: Specialized terminal execution.
5. **`fetch_url`**: Real-time web content research.

---

## V. Technical Architecture & File Structure

```text
src/
├── main.ts             # Entry point (~50 lines)
├── config.ts           # Config & Env loading (~200 lines)
├── gateway/            # Web Server & Auth (~350 lines)
├── channels/           # Telegram & Feishu adapters (~1,400 lines)
├── agent/              # Runner, Tools & Context management (~1,300 lines)
├── memory/             # Storage, Search & Consolidation (~750 lines)
├── session/            # Transcript & Routing (~400 lines)
└── security/           # Whitelist & Auth (~300 lines)
```

**Total Functional Code**: ~5,550 Lines
**Total with Types & Tests**: ~6,500 Lines

---

## VI. Summary of Re-engineering

| | OpenClaw v1.4.x (LTS) | SoulClaw (v0.1) |
|---|---|---|
| **Codebase** | 562,804 Lines | **3,863 Lines (0.68% for ~85% power)** |
| **Memory** | Database-driven | **Cognitive-driven (Recollection)** |
| **System Prompt** | Hardcoded & Opaque | **Transparent & User-Defined** |
| **Security Surface** | Large Exposure / Multi-Tenant | **Minimalist / Whitelist / Zero-Trust** |
| **Deployment** | Heavy Dependencies | **Zero External Dependencies** |

---
## VII. Future Growth & Extensibility

As SoulClaw is a newly reconstructed project, its current feature set focuses on the **85% most impactful capabilities**. 

We adopt a **Just-In-Time Development** philosophy: features are not added for curiosity but for necessity. Future milestones include:
- **Rich Media Handling**: Enhanced reasoning for complex visual and auditory inputs.
- **Dynamic Tool Discovery**: Automatic capability expansion based on environment changes.
- **Deep Browser Integration**: Giving the agent its own sandbox browser for complex research.

SoulClaw is a living system. It starts lean to remain fast, but it is built to grow wherever its user's ambition leads.

---
**Project Milestones:**
- 📅 **2026/03/26**: Project Construction Started.
- 🚀 **2026/04/05**: Official Launch on GitHub.
- 🧬 **Post-Launch**: Continuous Evolution & Refinement.

---
*Created by Zhipeng Li. Re-constructed from OpenClaw's architectural concepts.*
