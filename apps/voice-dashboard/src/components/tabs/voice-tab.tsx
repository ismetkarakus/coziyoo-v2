"use client";

import { useEffect, useState } from "react";
import type { Control, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { Controller } from "react-hook-form";
import { ConnectionTest } from "@/components/forms/connection-test";
import { KeyValueEditor } from "@/components/forms/key-value-editor";
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

export function VoiceTab({ control, register, watch }: TabProps) {
  const { result, testTts } = useConnectionTest();
  const [testText, setTestText] = useState("Merhaba, bu bir test mesajidir.");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!result.audioBlob) return;
    const objectUrl = URL.createObjectURL(result.audioBlob);
    setAudioUrl(objectUrl);
    const audio = new Audio(objectUrl);
    void audio.play().catch(() => {});
    return () => URL.revokeObjectURL(objectUrl);
  }, [result.audioBlob]);

  const runTtsTest = () => {
    const apiKey = watch("tts_config.api_key");
    const authHeader = apiKey ? `Bearer ${apiKey}` : undefined;

    void testTts({
      baseUrl: watch("tts_config.base_url"),
      synthPath: watch("tts_config.endpoint_path"),
      textFieldName: watch("tts_config.text_field_name"),
      bodyParams: watch("tts_config.custom_body_params"),
      authHeader,
      text: testText,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice Configuration</CardTitle>
        <CardDescription>Configure TTS provider and run voice synthesis tests.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">TTS Connection</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tts-base-url">Base URL</Label>
              <Input id="tts-base-url" {...register("tts_config.base_url")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tts-api-key">API Key</Label>
              <Input id="tts-api-key" type="password" {...register("tts_config.api_key")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tts-model">Model</Label>
              <Input id="tts-model" {...register("tts_config.model")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tts-endpoint-path">Endpoint Path</Label>
              <Input id="tts-endpoint-path" placeholder="/v1/audio/speech" {...register("tts_config.endpoint_path")} />
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Voice Settings</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tts-voice-id">Voice ID</Label>
              <Input id="tts-voice-id" placeholder="alloy" {...register("tts_config.voice_id")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tts-text-field-name">Text Field Name</Label>
              <Input id="tts-text-field-name" placeholder="input" {...register("tts_config.text_field_name")} />
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Custom Headers</h3>
          <Controller
            control={control}
            name="tts_config.custom_headers"
            render={({ field }) => <KeyValueEditor value={field.value} onChange={field.onChange} />}
          />
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Custom Body Params</h3>
          <Controller
            control={control}
            name="tts_config.custom_body_params"
            render={({ field }) => <KeyValueEditor value={field.value} onChange={field.onChange} />}
          />
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Test TTS</h3>
          <div className="space-y-1.5">
            <Label htmlFor="tts-test-text">Test Text</Label>
            <Input id="tts-test-text" value={testText} onChange={(event) => setTestText(event.target.value)} />
          </div>
          <ConnectionTest status={result.status} detail={result.detail} onTest={runTtsTest} label="Test TTS" />
          {audioUrl && (
            <audio controls className="w-full" src={audioUrl}>
              <track kind="captions" />
            </audio>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
