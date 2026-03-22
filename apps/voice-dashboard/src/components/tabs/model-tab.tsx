"use client";

import type { Control, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { Controller } from "react-hook-form";
import { ConnectionTest } from "@/components/forms/connection-test";
import { KeyValueEditor } from "@/components/forms/key-value-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConnectionTest } from "@/lib/hooks/use-connection-test";
import type { ProfileFormValues } from "@/lib/schemas/profile";

type TabProps = {
  control: Control<ProfileFormValues>;
  register: UseFormRegister<ProfileFormValues>;
  watch: UseFormWatch<ProfileFormValues>;
  setValue: UseFormSetValue<ProfileFormValues>;
};

export function ModelTab({ control, register, watch }: TabProps) {
  const { result, testLlm } = useConnectionTest();
  const greetingEnabled = watch("greeting_enabled");
  const runLlmTest = () => {
    void testLlm({
      baseUrl: watch("llm_config.base_url"),
      endpointPath: watch("llm_config.endpoint_path"),
      apiKey: watch("llm_config.api_key"),
      model: watch("llm_config.model"),
      customHeaders: watch("llm_config.custom_headers"),
      customBodyParams: watch("llm_config.custom_body_params"),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Configuration</CardTitle>
        <CardDescription>Configure LLM connection, prompt, and conversation start behavior.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">LLM Connection</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="llm-base-url">Base URL</Label>
              <Input id="llm-base-url" placeholder="https://api.openai.com" {...register("llm_config.base_url")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-api-key">API Key</Label>
              <Input id="llm-api-key" type="password" {...register("llm_config.api_key")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-model">Model</Label>
              <Input id="llm-model" placeholder="gpt-4o" {...register("llm_config.model")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-endpoint-path">Endpoint Path</Label>
              <Input
                id="llm-endpoint-path"
                placeholder="/v1/chat/completions"
                {...register("llm_config.endpoint_path")}
              />
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Custom Headers</h3>
          <Controller
            control={control}
            name="llm_config.custom_headers"
            render={({ field }) => <KeyValueEditor value={field.value} onChange={field.onChange} />}
          />
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Custom Body Params</h3>
          <Controller
            control={control}
            name="llm_config.custom_body_params"
            render={({ field }) => <KeyValueEditor value={field.value} onChange={field.onChange} />}
          />
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Test LLM</h3>
          <ConnectionTest
            status={result.status}
            detail={result.detail}
            statusCode={result.statusCode}
            onTest={runLlmTest}
            label="Test LLM"
          />
          {result.status !== "idle" && (
            <p className="text-xs text-muted-foreground">
              {result.status === "success"
                ? "Model provider baglantisi dogrulandi."
                : "Ayarlarini kontrol et, sonra tekrar dene."}
            </p>
          )}
        </section>

        <Separator />

        <section className="space-y-2">
          <Label htmlFor="model-system-prompt">System Prompt</Label>
          <Textarea
            id="model-system-prompt"
            rows={8}
            placeholder="You are a helpful food ordering assistant..."
            {...register("system_prompt")}
          />
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Conversation Start</h3>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Assistant speaks first</p>
              <p className="text-xs text-muted-foreground">
                When enabled, assistant starts the conversation. Otherwise it waits for the user first.
              </p>
            </div>
            <Controller
              control={control}
              name="speaks_first"
              render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />}
            />
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Greeting Config</h3>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="greeting-enabled">Greeting Enabled</Label>
            <Controller
              control={control}
              name="greeting_enabled"
              render={({ field }) => (
                <Switch id="greeting-enabled" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          {greetingEnabled && (
            <div className="space-y-1.5">
              <Label htmlFor="greeting-instruction">Greeting Instruction</Label>
              <Textarea
                id="greeting-instruction"
                rows={3}
                placeholder="Kisaca karsila, menuye yonlendir."
                {...register("greeting_instruction")}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="voice-language">Voice Language</Label>
            <Input id="voice-language" placeholder="tr" {...register("voice_language")} />
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
