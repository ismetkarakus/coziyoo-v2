"use client";

import type { Control, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { toast } from "sonner";
import { ConnectionTest } from "@/components/forms/connection-test";
import { CurlImportDialog } from "@/components/forms/curl-import-dialog";
import type { ParsedCurlResult } from "@/lib/utils/curl-parser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useConnectionTest } from "@/lib/hooks/use-connection-test";
import type { ProfileFormValues } from "@/lib/schemas/profile";

type TabProps = {
  control: Control<ProfileFormValues>;
  register: UseFormRegister<ProfileFormValues>;
  watch: UseFormWatch<ProfileFormValues>;
  setValue: UseFormSetValue<ProfileFormValues>;
};

export function ToolsTab({ register, watch, setValue }: TabProps) {
  const { result, testN8n } = useConnectionTest();

  const runN8nTest = () => {
    void testN8n({
      baseUrl: watch("n8n_config.base_url"),
      webhookPath: watch("n8n_config.webhook_path"),
    });
  };

  const applyParsed = (target: "llm" | "tts" | "stt" | "n8n", parsed: ParsedCurlResult) => {
    if (target === "llm") {
      if (parsed.base_url) setValue("llm_config.base_url", parsed.base_url);
      if (parsed.api_key) setValue("llm_config.api_key", parsed.api_key);
      if (parsed.model) setValue("llm_config.model", parsed.model);
      if (parsed.endpoint_path) setValue("llm_config.endpoint_path", parsed.endpoint_path);
      if (parsed.custom_headers) setValue("llm_config.custom_headers", parsed.custom_headers);
      if (parsed.custom_body_params) setValue("llm_config.custom_body_params", parsed.custom_body_params);
      return;
    }

    if (target === "tts") {
      if (parsed.base_url) setValue("tts_config.base_url", parsed.base_url);
      if (parsed.api_key) setValue("tts_config.api_key", parsed.api_key);
      if (parsed.model) setValue("tts_config.model", parsed.model);
      if (parsed.endpoint_path) setValue("tts_config.endpoint_path", parsed.endpoint_path);
      if (parsed.custom_headers) setValue("tts_config.custom_headers", parsed.custom_headers);
      if (parsed.custom_body_params) setValue("tts_config.custom_body_params", parsed.custom_body_params);
      if (parsed.voice_id) setValue("tts_config.voice_id", parsed.voice_id);
      if (parsed.text_field_name) setValue("tts_config.text_field_name", parsed.text_field_name);
      return;
    }

    if (target === "stt") {
      if (parsed.base_url) setValue("stt_config.base_url", parsed.base_url);
      if (parsed.api_key) setValue("stt_config.api_key", parsed.api_key);
      if (parsed.model) setValue("stt_config.model", parsed.model);
      if (parsed.endpoint_path) setValue("stt_config.endpoint_path", parsed.endpoint_path);
      if (parsed.custom_headers) setValue("stt_config.custom_headers", parsed.custom_headers);
      if (parsed.custom_body_params) setValue("stt_config.custom_body_params", parsed.custom_body_params);
      return;
    }

    if (parsed.base_url) setValue("n8n_config.base_url", parsed.base_url);
    if (parsed.endpoint_path) setValue("n8n_config.webhook_path", parsed.endpoint_path);
  };

  const handleCurlImport = (parsed: ParsedCurlResult) => {
    const fingerprint = `${parsed.base_url ?? ""} ${parsed.endpoint_path ?? ""}`.toLowerCase();
    let target: "llm" | "tts" | "stt" | "n8n" = "llm";

    if (fingerprint.includes("webhook") || fingerprint.includes("n8n")) target = "n8n";
    else if (fingerprint.includes("transcri")) target = "stt";
    else if (fingerprint.includes("speech") || fingerprint.includes("audio")) target = "tts";

    applyParsed(target, parsed);
    toast.success(`Imported cURL into ${target.toUpperCase()} config.`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tools Configuration</CardTitle>
        <CardDescription>Configure n8n endpoints, test connectivity, and import from cURL commands.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">N8N Configuration</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="n8n-base-url">N8N Base URL</Label>
              <Input id="n8n-base-url" placeholder="https://n8n.example.com" {...register("n8n_config.base_url")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="n8n-webhook-path">Webhook Path</Label>
              <Input id="n8n-webhook-path" placeholder="/webhook/order" {...register("n8n_config.webhook_path")} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="n8n-mcp-webhook-path">MCP Webhook Path</Label>
              <Input
                id="n8n-mcp-webhook-path"
                placeholder="/webhook/mcp"
                {...register("n8n_config.mcp_webhook_path")}
              />
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Test N8N</h3>
          <ConnectionTest status={result.status} detail={result.detail} onTest={runN8nTest} label="Test N8N" />
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">cURL Import</h3>
          <CurlImportDialog onImport={handleCurlImport} />
        </section>
      </CardContent>
    </Card>
  );
}
