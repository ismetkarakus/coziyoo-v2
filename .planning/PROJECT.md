# Coziyoo v2

## What This Is

Coziyoo is a marketplace for home-cooked meals. Home cooks list their food as lots; buyers discover and order via a voice-first mobile app. An AI voice agent (LiveKit) takes orders through natural conversation, then fires a webhook to n8n which handles LLM orchestration, notifications, and payment processing. An admin panel manages users, orders, and platform settings.

## Core Value

A buyer opens the mobile app, speaks to an AI agent, and their order is placed — no tapping required.

## Requirements

### Validated

- ✓ REST API with Express/TypeScript — existing
- ✓ JWT auth (app realm + admin realm) — existing
- ✓ PostgreSQL data layer with migrations — existing
- ✓ Order state machine — existing
- ✓ LiveKit voice agent (Python) — existing (partially)
- ✓ n8n service integration stub — existing
- ✓ Mobile app (Expo/React Native) — existing (partially)
- ✓ Admin panel (React/Vite) — existing (partially)
- ✓ Food lots management — existing
- ✓ Finance/payouts/commission system — existing

### Active

- [ ] Mobile app → API voice session flow works end-to-end
- [ ] LiveKit voice session starts reliably from mobile
- [ ] Voice agent conversation flow is observable (logs/viewer at :9000)
- [ ] End-of-call webhook fires to n8n reliably
- [ ] n8n processes order and creates it in the database
- [ ] n8n sends notifications after order creation
- [ ] n8n handles payment processing trigger
- [ ] Admin panel: manage cooks/users
- [ ] Admin panel: monitor orders
- [ ] Admin panel: view voice session logs
- [ ] Admin panel: configure/trigger n8n workflows

### Out of Scope

- Cook voice ordering — not defined yet, buyer voice-first only
- Real-time chat — not core to voice-first value
- Web storefront — mobile-first platform

## Context

This is a brownfield project. The full service structure exists (API, admin, mobile, voice agent) but the integration seams between them are broken or unverified. Key problems reported:
- Voice session startup from mobile is unreliable
- Voice agent → n8n end-of-call webhook doesn't fire correctly
- n8n → order creation flow isn't working
- The voice agent log viewer at localhost:9000/logs/viewer is not healthy for debugging

The voice agent is Python/LiveKit Agents, running as a worker + FastAPI dispatch server on port 9000. The n8n brain handles LLM calls, notifications, and payment triggers. The mobile app is Expo/React Native.

## Constraints

- **Tech stack**: Must stay with existing stack (Node.js API, Python voice agent, LiveKit, n8n, Expo mobile)
- **Integration**: n8n is the LLM brain and orchestrator — don't replace it with direct API calls
- **Observability**: Voice agent logs must be debuggable (fix the log viewer)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| n8n as LLM brain (not direct Ollama calls from agent) | Flexibility to change LLM providers and add workflow logic without redeploying voice agent | — Pending |
| LiveKit for voice (not WebRTC directly) | Managed infrastructure, room-based sessions, data channels for UI actions | — Pending |
| Voice-first buyer flow as v1 milestone | Cook flow not defined — validate buyer ordering first | — Pending |

---
*Last updated: 2026-03-12 after initialization*
