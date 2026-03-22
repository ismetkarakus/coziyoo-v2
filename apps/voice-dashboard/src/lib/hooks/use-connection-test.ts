"use client";

import { useCallback, useState } from "react";
import { parseJson, request } from "@/lib/api";

type TestStatus = "idle" | "testing" | "success" | "error";

export type TestResult = {
  status: TestStatus;
  detail?: string;
  audioBlob?: Blob;
  transcript?: string;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useConnectionTest() {
  const [result, setResult] = useState<TestResult>({ status: "idle" });

  const testStt = useCallback(async (config: { baseUrl: string; transcribePath?: string; authHeader?: string }) => {
    setResult({ status: "testing" });
    try {
      const response = await request("/v1/admin/livekit/test/stt", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          transcribePath: config.transcribePath,
          authHeader: config.authHeader,
        }),
      });

      if (!response.ok) throw new Error("STT server unreachable");

      setResult({ status: "success", detail: "STT server is reachable" });
    } catch (error) {
      setResult({ status: "error", detail: getErrorMessage(error, "Test failed") });
    }
  }, []);

  const testSttTranscribe = useCallback(async (config: {
    baseUrl: string;
    transcribePath?: string;
    audio: string;
    model?: string;
    language?: string;
    queryParams?: Record<string, string>;
    authHeader?: string;
  }) => {
    setResult({ status: "testing" });
    try {
      const response = await request("/v1/admin/livekit/test/stt/transcribe", {
        method: "POST",
        body: JSON.stringify(config),
      });

      if (!response.ok) throw new Error("STT transcription failed");

      const json = await parseJson<{ data: { transcript?: string; text?: string; raw?: unknown } }>(response);
      const transcript = json.data.transcript ?? json.data.text ?? JSON.stringify(json.data.raw);
      setResult({ status: "success", transcript, detail: "Transcription complete" });
    } catch (error) {
      setResult({ status: "error", detail: getErrorMessage(error, "Test failed") });
    }
  }, []);

  const testTts = useCallback(async (config: {
    baseUrl: string;
    synthPath?: string;
    textFieldName?: string;
    bodyParams?: Record<string, string>;
    authHeader?: string;
    text?: string;
  }) => {
    setResult({ status: "testing" });
    try {
      const response = await request("/v1/admin/livekit/test/tts", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          synthPath: config.synthPath,
          textFieldName: config.textFieldName ?? "input",
          bodyParams: config.bodyParams ?? {},
          authHeader: config.authHeader,
          text: config.text ?? "Merhaba, bu bir test mesajidir.",
        }),
      });

      if (!response.ok) throw new Error("TTS test failed");

      const blob = await response.blob();
      setResult({ status: "success", audioBlob: blob, detail: "Audio generated" });
    } catch (error) {
      setResult({ status: "error", detail: getErrorMessage(error, "Test failed") });
    }
  }, []);

  const testN8n = useCallback(async (config: { baseUrl: string; webhookPath?: string }) => {
    setResult({ status: "testing" });
    try {
      const response = await request("/v1/admin/livekit/test/n8n", {
        method: "POST",
        body: JSON.stringify(config),
      });

      if (!response.ok) throw new Error("N8N server unreachable");

      setResult({ status: "success", detail: "N8N webhook is reachable" });
    } catch (error) {
      setResult({ status: "error", detail: getErrorMessage(error, "Test failed") });
    }
  }, []);

  const reset = useCallback(() => setResult({ status: "idle" }), []);

  return { result, testStt, testSttTranscribe, testTts, testN8n, reset };
}
