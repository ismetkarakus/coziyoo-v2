const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

async function main() {
  const docs = await fetch(`${baseUrl}/v1/docs`);
  if (docs.status !== 200) {
    throw new Error(`docs page failed: status=${docs.status}`);
  }

  const html = await docs.text();
  if (!html.includes("SwaggerUIBundle")) {
    throw new Error("docs html does not include Swagger UI bootstrap");
  }

  const raw = await fetch(`${baseUrl}/v1/docs/openapi.yaml`);
  if (raw.status !== 200) {
    throw new Error(`openapi yaml failed: status=${raw.status}`);
  }

  const yaml = await raw.text();
  if (!yaml.includes("openapi: 3.1.0")) {
    throw new Error("openapi yaml content invalid");
  }

  console.log("Docs smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
