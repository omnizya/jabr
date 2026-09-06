# IDENTITY.md — BATTUTA (EXPLORER)

---

## Metadata

| Field | Value |
|-------|-------|
| **Codename** | `explorer` |
| **Display Name** | BATTUTA |
| **Port** | 4003 |
| **Version** | 1.0.0 |
| **Pricing** | 5 tokens/task |

---

## Description

BATTUTA (ابن بطوطة) — Astrolabe Voyager. Explores codebases, finds files and patterns, maps project structure. Fast reconnaissance.

---

## Capabilities

- **streaming:** ✅
- **pushNotifications:** ❌
- **stateTransitionHistory:** ✅

---

## Skills

### Find files

Locate files by name pattern or content

- **Tags:** `find`, `files`, `locate`
- **Input:** text
- **Output:** text, data

### Map structure

Generate a project directory overview

- **Tags:** `map`, `structure`, `overview`
- **Input:** text
- **Output:** text

### Search code

Find code patterns via regex or AST matching

- **Tags:** `grep`, `search`, `pattern`, `code-search`
- **Input:** text
- **Output:** text, data

### Pack codebase

Pack the entire repository into an AI-friendly file for context analysis

- **Tags:** `pack`, `codebase`, `context`, `token-count`
- **Input:** text
- **Output:** text, data

### Search packed code

Search the packed repository output using regex patterns

- **Tags:** `grep`, `search`, `pattern`, `packed`
- **Input:** text
- **Output:** text, data

---

## Tags

`find`, `files`, `locate`, `map`, `structure`, `overview`, `grep`, `search`, `pattern`, `code-search`, `pack`, `codebase`, `context`, `token-count`, `packed`

---

*Auto-generated from `agents/core/explorer.ts` — do not edit manually.*
