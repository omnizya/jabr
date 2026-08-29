# Jabr Webhook & Bot Integration Research

**Date:** 2026-08-29
**Architecture:** Hexagonal (Ports & Adapters)
**Pattern:** Webhook-driven agent architecture

---

## Executive Summary

Jabr currently has no mechanism to receive external events. All agent communication is internal (A2A between specialists). To be a production-ready multi-agent system, Jabr needs:

1. **Webhook adapter** — receive HTTP callbacks from external services
2. **GitHub bot adapter** — react to PR events, issues, CI results
3. **Telegram bot adapter** — interact with users via Telegram
4. **WhatsApp bot adapter** — interact with users via WhatsApp Business API

All four follow the same hexagonal pattern: a port interface defining the contract, with concrete adapters for each platform.

---

## Webhook Architecture

### Pattern: Webhook-Driven Agent

The canonical pattern (Cloudflare Agents, 2026):

```typescript
// 1. Extract entity identifier from webhook payload
// 2. Route to dedicated agent instance
// 3. Agent loads session history from DB
// 4. Agent processes event
// 5. Agent saves new state
// 6. Return 200 OK
```

### Key Design Decisions

| Decision | Recommendation | Rationale |
|----------|----------------|-----------|
| **Idempotency** | Redis-style lock with 24h TTL | Prevent duplicate processing |
| **Delivery guarantee** | At-least-once + dedup | Webhooks may retry |
| **Signature verification** | HMAC-SHA256 | Security (verify sender) |
| **Async processing** | Queue + worker | Don't block HTTP response |
| **Session persistence** | SQLite (existing) | Load history by session_id |

### Webhook Port Interface (DDD)

```typescript
// ports/webhook-port.ts
export interface WebhookPort {
  // Verify webhook signature
  verifySignature(payload: string, signature: string, secret: string): boolean;
  
  // Parse webhook payload into normalized event
  parseEvent(payload: string): WebhookEvent;
  
  // Route event to appropriate agent
  routeEvent(event: WebhookEvent): Promise<void>;
}

export interface WebhookEvent {
  id: string;           // Unique event ID (for idempotency)
  source: string;       // 'github', 'telegram', 'whatsapp', etc.
  type: string;         // 'push', 'pull_request', 'message', etc.
  payload: unknown;     // Normalized payload
  timestamp: Date;
  sessionId?: string;   // For conversation continuity
}
```

---

## GitHub Bot Integration

### Use Cases

| Event | Agent Action |
|-------|--------------|
| `pull_request.opened` | Oracle reviews code |
| `pull_request.synchronize` | Re-review on new commits |
| `issues.opened` | Librarian researches issue |
| `check_run.failed` | Fixer investigates failure |
| `push` (main) | Jarvis scans for regressions |
| `release.published` | Librarian updates docs |

### GitHub Webhook Payload Structure

```typescript
// adapters/github-webhook.ts
export interface GitHubWebhookEvent extends WebhookEvent {
  source: 'github';
  type: 'push' | 'pull_request' | 'issues' | 'check_run' | 'release';
  payload: {
    repository: { full_name: string; default_branch: string };
    sender: { login: string; id: number };
    // Event-specific fields
    action?: string;           // 'opened', 'synchronize', 'closed'
    pull_request?: { number: string; head: { sha: string } };
    issue?: { number: string; title: string; body: string };
    // ...
  };
}
```

### GitHub Bot Port

```typescript
// ports/github-bot-port.ts
export interface GitHubBotPort extends WebhookPort {
  // Handle specific GitHub events
  handlePush(event: GitHubWebhookEvent): Promise<void>;
  handlePullRequest(event: GitHubWebhookEvent): Promise<void>;
  handleIssue(event: GitHubWebhookEvent): Promise<void>;
  handleCheckRun(event: GitHubWebhookEvent): Promise<void>;
  
  // Post responses back to GitHub
  createComment(repo: string, issueNumber: number, body: string): Promise<void>;
  updateCheckRun(checkRunId: number, status: 'in_progress' | 'completed', conclusion: 'success' | 'failure'): Promise<void>;
}
```

### Implementation Notes

- **Authentication:** GitHub App with private key (not personal access token)
- **Webhook secret:** Verify `X-Hub-Signature-256` header
- **Idempotency:** Use `X-GitHub-Delivery` GUID as event ID
- **Rate limiting:** GitHub API has 5000 requests/hour (use conditional requests with ETags)

---

## Telegram Bot Integration

### Use Cases

| User Message | Agent Action |
|--------------|--------------|
| `/review <code>` | Oracle reviews code |
| `/fix <description>` | Fixer implements fix |
| `/research <topic>` | Librarian searches |
| `/scan` | Jarvis scans codebase |
| `/status` | Orchestrator reports system state |
| Any natural language | Orchestrator routes to best agent |

### Telegram Bot API

**Two modes:**
1. **Polling** — `getUpdates` (simpler, not recommended for production)
2. **Webhook** — `setWebhook` (production, event-driven)

**Jabr choice:** Webhook (consistent with architecture)

### Telegram Webhook Payload

```typescript
// adapters/telegram-webhook.ts
export interface TelegramWebhookEvent extends WebhookEvent {
  source: 'telegram';
  type: 'message' | 'callback_query' | 'inline_query';
  payload: {
    update_id: number;
    message?: {
      message_id: number;
      from: { id: number; first_name: string; username?: string };
      chat: { id: number; type: 'private' | 'group' };
      text?: string;
      // ...
    };
  };
  sessionId: string;  // chat_id for conversation continuity
}
```

### Telegram Bot Port

```typescript
// ports/telegram-bot-port.ts
export interface TelegramBotPort extends WebhookPort {
  // Send messages
  sendMessage(chatId: number, text: string, options?: { parse_mode?: 'Markdown' | 'HTML'; reply_markup?: unknown }): Promise<void>;
  
  // Send typing indicator
  sendChatAction(chatId: number, action: 'typing' | 'upload_document'): Promise<void>;
  
  // Answer callback queries (inline keyboards)
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
  
  // Set webhook URL
  setWebhook(url: string, secretToken: string): Promise<void>;
}
```

### Implementation Notes

- **Authentication:** Bot token from @BotFather
- **Webhook secret:** `X-Telegram-Bot-Api-Secret-Token` header
- **Session:** `chat_id` as session_id (conversation continuity)
- **Rate limits:** 30 messages/second to same chat, 20 messages/minute to different chats

---

## WhatsApp Business API Integration

### Use Cases

| User Message | Agent Action |
|--------------|--------------|
| "Review this code" | Oracle reviews |
| "Fix the bug" | Fixer implements |
| "Research X" | Librarian searches |
| "Status" | Orchestrator reports |
| Any natural language | Orchestrator routes |

### WhatsApp Business Cloud API

**Two options:**
1. **WhatsApp Business Cloud API** (Meta-hosted, easier)
2. **WhatsApp Business On-Premises API** (self-hosted, more control)

**Jabr choice:** Cloud API (simpler, no infrastructure)

### WhatsApp Webhook Payload

```typescript
// adapters/whatsapp-webhook.ts
export interface WhatsAppWebhookEvent extends WebhookEvent {
  source: 'whatsapp';
  type: 'message' | 'status';
  payload: {
    entry: [{
      id: string;  // Business account ID
      changes: [{
        value: {
          messaging_product: 'whatsapp';
          metadata: { display_phone_number: string; phone_number_id: string };
          messages?: [{
            from: string;  // User phone number
            id: string;    // Message ID (for dedup)
            timestamp: string;
            text?: { body: string };
            // ...
          }];
        };
      }];
    }];
  };
  sessionId: string;  // User phone number for conversation continuity
}
```

### WhatsApp Bot Port

```typescript
// ports/whatsapp-bot-port.ts
export interface WhatsAppBotPort extends WebhookPort {
  // Send text message
  sendMessage(to: string, text: string): Promise<void>;
  
  // Send interactive message (buttons, lists)
  sendInteractiveMessage(to: string, header: string, body: string, buttons: { id: string; title: string }[]): Promise<void>;
  
  // Send document
  sendDocument(to: string, document: Buffer, filename: string): Promise<void>;
  
  // Mark message as read
  markAsRead(messageId: string): Promise<void>;
}
```

### Implementation Notes

- **Authentication:** System User Access Token + Phone Number ID
- **Webhook secret:** Verify `X-Hub-Signature-256` (if configured)
- **Session:** User phone number as session_id
- **Rate limits:** 250 messages/second (business), 50 messages/second (marketing)
- **Template messages:** Required for outbound notifications (pre-approved templates)

---

## Hexagonal Architecture Mapping

### Ports (Domain Layer)

```
agents/ports/
├── webhook-port.ts          # Generic webhook contract
├── github-bot-port.ts       # GitHub-specific contract
├── telegram-bot-port.ts     # Telegram-specific contract
└── whatsapp-bot-port.ts     # WhatsApp-specific contract
```

### Adapters (Infrastructure Layer)

```
agents/adapters/
├── http/
│   ├── webhook-server.ts    # Generic HTTP webhook server
│   ├── github-webhook.ts    # GitHub webhook adapter
│   ├── telegram-webhook.ts  # Telegram webhook adapter
│   └── whatsapp-webhook.ts  # WhatsApp webhook adapter
```

### Domain Events (Core Layer)

```
agents/core/
├── webhook-event.ts         # Normalized webhook event types
└── webhook-router.ts        # Route events to agents
```

---

## TDD Test Plan

### Unit Tests (ports)

```typescript
// tests/ports/webhook-port.test.ts
describe("WebhookPort.verifySignature", () => {
  test("returns true for valid HMAC-SHA256 signature");
  test("returns false for invalid signature");
  test("returns false for missing signature");
});

describe("WebhookPort.parseEvent", () => {
  test("parses GitHub push event");
  test("parses Telegram message event");
  test("parses WhatsApp message event");
  test("throws on unknown event source");
});
```

### Unit Tests (adapters)

```typescript
// tests/adapters/github-webhook.test.ts
describe("GitHubWebhookAdapter", () => {
  test("verifies X-Hub-Signature-256 header");
  test("parses pull_request event");
  test("routes to Oracle for PR review");
  test("creates comment on PR");
  test("updates check run status");
});

// tests/adapters/telegram-webhook.test.ts
describe("TelegramWebhookAdapter", () => {
  test("verifies X-Telegram-Bot-Api-Secret-Token header");
  test("parses message event");
  test("routes to Orchestrator for natural language");
  test("sends message to chat");
  test("sends typing indicator");
});

// tests/adapters/whatsapp-webhook.test.ts
describe("WhatsAppWebhookAdapter", () => {
  test("parses message event");
  test("routes to Orchestrator for natural language");
  test("sends text message");
  test("sends interactive message with buttons");
  test("marks message as read");
});
```

### Integration Tests

```typescript
// tests/e2e-webhook.test.ts
describe("Webhook E2E", () => {
  test("GitHub PR opened → Oracle reviews → comment posted");
  test("Telegram /review → Oracle reviews → response sent");
  test("WhatsApp 'fix bug' → Fixer implements → response sent");
  test("Duplicate webhook event → idempotent (no duplicate processing)");
  test("Invalid signature → 401 Unauthorized");
});
```

---

## Implementation Roadmap

### Phase 1: Generic Webhook Server (2-3 days)

- [ ] Create `WebhookPort` interface
- [ ] Create `WebhookEvent` normalized type
- [ ] Implement `WebhookServer` (Bun.serve with POST /webhook)
- [ ] Add HMAC-SHA256 signature verification
- [ ] Add idempotency (Redis-style lock)
- [ ] Add event routing to agents

### Phase 2: GitHub Bot (2-3 days)

- [ ] Create `GitHubBotPort` interface
- [ ] Implement `GitHubWebhookAdapter`
- [ ] Handle `push`, `pull_request`, `issues`, `check_run` events
- [ ] Post comments on PRs/issues
- [ ] Update check run status
- [ ] Add GitHub App authentication

### Phase 3: Telegram Bot (2-3 days)

- [ ] Create `TelegramBotPort` interface
- [ ] Implement `TelegramWebhookAdapter`
- [ ] Handle `message`, `callback_query` events
- [ ] Send messages, typing indicators, inline keyboards
- [ ] Set webhook URL on startup
- [ ] Add bot token authentication

### Phase 4: WhatsApp Bot (3-4 days)

- [ ] Create `WhatsAppBotPort` interface
- [ ] Implement `WhatsAppWebhookAdapter`
- [ ] Handle `message`, `status` events
- [ ] Send text, interactive messages, documents
- [ ] Mark messages as read
- [ ] Add template message support

### Phase 5: E2E Testing (2-3 days)

- [ ] GitHub PR → Oracle review → comment
- [ ] Telegram /review → Oracle review → response
- [ ] WhatsApp 'fix bug' → Fixer → response
- [ ] Idempotency tests
- [ ] Signature verification tests

---

## Security Considerations

| Threat | Mitigation |
|--------|------------|
| **Webhook spoofing** | HMAC-SHA256 signature verification |
| **Replay attacks** | Idempotency lock with TTL |
| **Token exposure** | Environment variables, never commit |
| **Rate limiting** | Per-caller rate limits (existing RateLimiter) |
| **Input validation** | JSON Schema validation on all payloads |
| **Output sanitization** | Escape HTML/Markdown in responses |

---

## Research Sources

- [Webhook-Driven Agent Architecture 2026](https://www.buildmvpfast.com/blog/webhook-driven-agent-architecture-event-based-triggers-autonomous-ai-workflows-2026)
- [Cloudflare Agents Webhooks](https://developers.cloudflare.com/agents/communication-channels/webhooks/)
- [MCP Event Gateway](https://hookdeck.com/blog/mcp-event-gateway)
- [Claude API Webhooks](https://claude-api-cookbook.vercel.app/claude-api-webhooks/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [GitHub Webhooks Docs](https://docs.github.com/en/webhooks)
