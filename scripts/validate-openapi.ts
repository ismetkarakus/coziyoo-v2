import SwaggerParser from "@apidevtools/swagger-parser";
import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

async function main() {
  const specPath = path.resolve(process.cwd(), "openapi/v1.yaml");
  const raw = await readFile(specPath, "utf8");
  const doc = YAML.parse(raw) as { openapi?: string; paths?: Record<string, unknown> };

  if (!doc.openapi?.startsWith("3.")) {
    throw new Error("OpenAPI version must be 3.x");
  }
  if (!doc.paths || Object.keys(doc.paths).length === 0) {
    throw new Error("OpenAPI spec must define at least one path");
  }

  await SwaggerParser.validate(specPath);
  console.log(`OpenAPI validation passed: ${specPath}`);
  console.log(`Path count: ${Object.keys(doc.paths).length}`);
}

main().catch((error) => {
  console.error("OpenAPI validation failed:", error);
  process.exit(1);
});

