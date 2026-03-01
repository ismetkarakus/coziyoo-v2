import { Router } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

const openapiPath = path.resolve(process.cwd(), "openapi", "v1.yaml");

function docsDisabled() {
  return !env.DOCS_ENABLED;
}

function getSwaggerHtml(specUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Coziyoo API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #f4f7fb; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: "#swagger-ui",
        deepLinking: true,
        displayRequestDuration: true,
        persistAuthorization: true,
      });
    </script>
  </body>
</html>`;
}

export const docsRouter = Router();

docsRouter.get("/openapi.yaml", (_req, res) => {
  if (docsDisabled()) {
    return res.status(404).json({ error: { code: "DOCS_DISABLED", message: "API docs disabled in this environment" } });
  }

  const raw = readFileSync(openapiPath, "utf8");
  res.type("application/yaml");
  return res.send(raw);
});

docsRouter.get("/", (req, res) => {
  if (docsDisabled()) {
    return res.status(404).json({ error: { code: "DOCS_DISABLED", message: "API docs disabled in this environment" } });
  }

  const specUrl = `${req.baseUrl}/openapi.yaml`;
  return res.type("text/html").send(getSwaggerHtml(specUrl));
});
