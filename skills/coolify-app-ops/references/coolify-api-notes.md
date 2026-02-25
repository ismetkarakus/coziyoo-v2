# Coolify API Notes

Use these endpoints for application operations:

- `GET /api/v1/applications` to list applications.
- `GET /api/v1/applications/{uuid}/envs` to list env vars.
- `POST /api/v1/applications/{uuid}/envs` to create env vars.
- `PATCH|PUT /api/v1/applications/{uuid}/envs/{env_uuid}` to update env vars (version-dependent).
- `DELETE /api/v1/applications/{uuid}/envs/{env_uuid}` to remove env vars.
- `POST|GET /api/v1/applications/{uuid}/deploy` to trigger redeploy (method may vary by Coolify version).
- `GET /api/v1/applications/{uuid}/logs` to retrieve deploy/runtime logs.

Authentication:

- Header: `Authorization: Bearer <token>`
- Header: `Accept: application/json`

Tips:

- Prefer app UUID over name whenever possible.
- If endpoint method support differs in your Coolify version, inspect the API docs at `/docs/api-reference` on your own Coolify instance.
- After changing critical env vars, call deploy and then read logs to verify startup success.
