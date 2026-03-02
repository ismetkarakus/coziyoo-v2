# Voice Agent Tasklist

## Completed
1. Scaffolded Python package with provider interfaces.
2. Added dispatch API endpoint `/livekit/agent-session`.
3. Added LiveKit agent worker entrypoint scaffold.
4. Added strict action envelope schema.

## Next
1. Add LLM tool-calling pipeline for structured UI actions.
2. Add session-end summary generation and callback retries.
3. Add provider-level unit/integration tests.

## Newly Completed
1. Wired dispatch endpoint to queue-backed worker orchestration with task IDs and status polling.
2. Replaced placeholder TTS module with remote TTS provider adapter.
3. Added dispatch manager queue flow test.
