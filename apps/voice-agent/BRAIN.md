# Coziyoo Brain (n8n)

## Purpose
Build a **visual, decision-driven brain** in n8n for voice conversations.

Your target flow is:
1. User speaks.
2. STT transcribes speech to text.
3. Transcribed text goes to n8n brain.
4. Brain decides next step with LLM:
   - direct answer, or
   - call tool/API (database questioning as MCP tool).
5. Brain returns final reply text.
6. TTS converts reply text to audio.

The goal is to keep conversation logic and decision trees visible in n8n, not hidden in worker code.

## Workflows
- Primary brain workflow: `6KFFgjd26nF0kNCA`
- MCP/API gateway workflow: `XYiIkxpa4PlnddQt`

### Intended responsibility split
- `6KFF...`:
  - normalize input
  - classify intent
  - decide direct reply vs tool call
  - call MCP workflow when needed
  - return final `replyText`
- `XYi...`:
  - tool/API orchestration
  - deterministic response envelope
  - monitoring/audit/latency info

## Runtime contract from voice-agent to n8n
Payload sent to brain includes:
- `workflowId`
- `source` (`voice-agent`)
- `timestamp`
- `roomId`
- `jobId`
- `deviceId`
- `userText`
- `messages[]`
- `mcpWorkflowId`

Brain should return one assistant text field:
- preferred: `replyText`
- also accepted by runtime fallback parser: `answer`, `text`, `output`, `message`

## Current routing behavior
Runtime uses n8n from device settings (DB) and prefers saved webhook values.

Priority:
1. explicit `webhookUrl` (if present),
2. `webhookPath` (can be full URL or relative path),
3. `baseUrl` + default path,
4. env fallback.

If `baseUrl` is already a full webhook URL, runtime uses it as-is.

## Admin configuration source
Configure n8n in:
- Admin page: `/#/app/voice-agent-settings`
- Stored in `starter_agent_settings.tts_config_json` under `n8n`/`n8nServers`

For production webhook usage, save URL like:
- `https://n8n.drascom.uk/webhook/coziyo-ask`

## Logging and observability
Logs viewer:
- `http://localhost:9000/logs/viewer`

Expected grouped flow:
- `stt -> n8n -> tts`

`n8n` log rows include:
- request endpoint and workflow
- response path (`webhook` / `execution_api`) and answer or error

## Important n8n webhook mode note
- `.../webhook-test/...` works only in n8n test mode (Execute Workflow in editor).
- For normal runtime traffic, use production webhook path `.../webhook/...`.

## Workflow sync and deploy commands
Sync local workflow JSON templates to hosted n8n:
```bash
cd /Users/drascom/Work/coziyoo-v2
python3 apps/voice-agent/scripts/sync_n8n_workflows.py --apply
```

Redeploy worker/api after voice-agent runtime changes:
```bash
cd /Users/drascom/Work/coziyoo-v2
docker compose up -d --force-recreate voice-agent-api voice-agent-worker
```

## Long-term direction
- Keep branching logic in n8n nodes for visibility.
- Keep worker focused on transport/runtime (LiveKit, STT/TTS plumbing, retries, logging).
- Use MCP workflow as the single gateway for database/API calls and monitoring.
