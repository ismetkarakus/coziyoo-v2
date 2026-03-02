# Task List - apps/agent

## Phase 1: App Scaffold

- [x] Create `apps/agent` workspace files (package, tsconfig, vite)
- [x] Create route structure (`/login`, `/settings`, `/home`)
- [x] Implement auth token storage and API client helpers

## Phase 2: Settings Flow

- [x] Link settings page from login
- [x] Load/save settings with `deviceId` using API
- [x] Surface Ollama models and n8n status
- [x] Add dedicated STT/Ollama/n8n test buttons backed by API endpoints

## Phase 3: Session Flow

- [x] Start session from home via `/v1/livekit/session/start`
- [ ] Connect and stream media with LiveKit client in-app
- [ ] Display transcript/events in home page

## Phase 4: API Modularization

- [ ] Extract n8n logic from routes into `services/n8n.ts`
- [ ] Rewire `/starter/tools/status` and `/starter/tools/run` to use service
- [ ] Add session-end webhook flow for sales outcomes

## Phase 5: Provider Modularity

- [ ] Add explicit provider config contract in API response payloads
- [ ] Add runtime provider factory skeleton for STT/TTS/LLM in agent runtime
- [ ] Implement remote-speech-server STT adapter
- [ ] Implement Ollama provider adapter

## Phase 6: Validation and Testing

- [ ] Add unit tests for settings mapping and API client
- [ ] Add API tests for settings and n8n service behavior
- [ ] Add end-to-end smoke test for login -> settings -> start session
