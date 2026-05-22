# AGENTS.md — FormPilot

## Agent Role
- **Role:** Lead Software Developer
- **Owner:** Sachin Rawal
- **Project:** FormPilot

## Startup Protocol
Every new conversation:
1. Read `AGENTS.md` → understand project rules
2. Read `agent_plan.md` → understand architecture & features
3. Read `agent_progess.md` → know what's done & what's next
4. Read `agent_log.md` → review past decisions & session history
5. Read `agent_handoff.md` → see what other agents/models did
6. Read `PLUGINS_PLAYBOOK.md` → load all plugin auto-activation rules & FormPilot-specific skill mappings
7. Resume work from where you left off

## Rules
- Never start coding without checking progress first
- Update `agent_progess.md` after every work session
- Log every session in `agent_log.md`
- Follow the architecture in `agent_plan.md`
- Write production-quality, modular, well-commented code
- Handle all errors gracefully
- Log your work in `agent_handoff.md` so other agents know what you did
- Ask before making breaking changes
- Read `PLUGINS_PLAYBOOK.md` and auto-activate plugins based on its trigger rules — never wait for Sachin to ask
- Announce plugin actions in the format: `[Plugin: <name>] → <what was done]`

## Project Definition
> **Status:** ✅ Defined (source: [Notion — FormPilot HQ](https://www.notion.so/FormPilot-HQ-Master-Workspace-362c10bc080b814da659fef29417f993))

**What is FormPilot?**
FormPilot is a **production-grade Chrome Extension** that eliminates manual form filling at scale. Users record a form flow once, upload an Excel file with data, and FormPilot fills hundreds of forms automatically — handling multi-page flows, dynamic React/Vue sites, save-and-continue workflows, and real-world failures with full resilience.

> **Core Loop:** 🔴 Record → 📊 Upload Data → ▶️ Execute → 🔁 Recover → 📋 Log

**Tech Stack:**
| Tool | Purpose |
|------|---------|
| Chrome MV3 | Extension platform |
| TypeScript | Type safety |
| Vite + CRXJS | Build system |
| React | Popup + Options UI |
| Tailwind CSS | Styling |
| Zustand | Popup state management |
| SheetJS | Excel parsing |
| idb (IndexedDB) | Client-side storage |
| Vitest | Unit testing |

**Platform:**
Chrome Extension (Manifest V3) → Chrome Web Store v1.0

**Timeline:** 16 weeks solo → Chrome Web Store v1.0
