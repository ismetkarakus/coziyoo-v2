"use client";

import { useRef, useState } from "react";
import type { Control, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { Controller } from "react-hook-form";
import { Mic, Square } from "lucide-react";
import { ConnectionTest } from "@/components/forms/connection-test";
import { KeyValueEditor } from "@/components/forms/key-value-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useConnectionTest } from "@/lib/hooks/use-connection-test";
import type { ProfileFormValues } from "@/lib/schemas/profile";

type TabProps = {
  control: Control<ProfileFormValues>;
  register: UseFormRegister<ProfileFormValues>;
  watch: UseFormWatch<ProfileFormValues>;
  setValue: UseFormSetValue<ProfileFormValues>;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to encode audio"));
        return;
      }
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Unable to read audio blob"));
    reader.readAsDataURL(blob);
  });
}

export function TranscriberTab({ control, register, watch }: TabProps) {
  const connectivityTest = useConnectionTest();
  const transcribeTest = useConnectionTest();

  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const runSttConnectionTest = () => {
    const apiKey = watch("stt_config.api_key");
    const authHeader = apiKey ? `Bearer ${apiKey}` : undefined;
    void connectivityTest.testStt({
      baseUrl: watch("stt_config.base_url"),
      transcribePath: watch("stt_config.endpoint_path"),
      authHeader,
    });
  };

  const startRecording = async () => {
    setRecordError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        try {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          const audioBase64 = await blobToBase64(blob);
          const apiKey = watch("stt_config.api_key");
          const authHeader = apiKey ? `Bearer ${apiKey}` : undefined;

          await transcribeTest.testSttTranscribe({
            baseUrl: watch("stt_config.base_url"),
            transcribePath: watch("stt_config.endpoint_path"),
            audio: audioBase64,
            model: watch("stt_config.model"),
            language: watch("stt_config.language"),
            queryParams: watch("stt_config.custom_query_params"),
            authHeader,
          });
        } catch (error) {
          setRecordError(error instanceof Error ? error.message : "Recording failed");
        } finally {
          mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
          setRecording(false);
        }
      };
      recorder.start();
      setRecording(true);
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : "Microphone access failed");
      setRecording(false);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transcriber Configuration</CardTitle>
        <CardDescription>Configure STT provider, test connectivity, and transcribe microphone input.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">STT Connection</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="stt-base-url">Base URL</Label>
              <Input id="stt-base-url" {...register("stt_config.base_url")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stt-api-key">API Key</Label>
              <Input id="stt-api-key" type="password" {...register("stt_config.api_key")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stt-model">Model</Label>
              <Input id="stt-model" {...register("stt_config.model")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stt-endpoint-path">Endpoint Path</Label>
              <Input id="stt-endpoint-path" placeholder="/v1/audio/transcriptions" {...register("stt_config.endpoint_path")} />
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-1.5">
          <Label htmlFor="stt-language">Language</Label>
          <Input id="stt-language" placeholder="tr" {...register("stt_config.language")} />
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Custom Headers</h3>
          <Controller
            control={control}
            name="stt_config.custom_headers"
            render={({ field }) => <KeyValueEditor value={field.value} onChange={field.onChange} />}
          />
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Custom Body Params</h3>
          <Controller
            control={control}
            name="stt_config.custom_body_params"
            render={({ field }) => <KeyValueEditor value={field.value} onChange={field.onChange} />}
          />
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Custom Query Params</h3>
          <Controller
            control={control}
            name="stt_config.custom_query_params"
            render={({ field }) => <KeyValueEditor value={field.value} onChange={field.onChange} />}
          />
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Test STT</h3>
          <ConnectionTest
            status={connectivityTest.result.status}
            detail={connectivityTest.result.detail}
            onTest={runSttConnectionTest}
            label="Test STT Connection"
          />

          <div className="flex items-center gap-3">
            {recording ? (
              <Button type="button" variant="destructive" onClick={stopRecording}>
                <Square className="size-4" />
                Stop
              </Button>
            ) : (
              <Button type="button" onClick={() => void startRecording()}>
                <Mic className="size-4" />
                Record
              </Button>
            )}
            {recording && <span className="text-sm text-destructive">Recording...</span>}
          </div>

          {transcribeTest.result.transcript && (
            <div className="space-y-1.5">
              <Label htmlFor="transcript-result">Transcript</Label>
              <Textarea id="transcript-result" rows={4} value={transcribeTest.result.transcript} readOnly />
            </div>
          )}

          {recordError && <p className="text-sm text-destructive">{recordError}</p>}
          {transcribeTest.result.status === "error" && (
            <p className="text-sm text-destructive">{transcribeTest.result.detail ?? "Transcription failed"}</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
