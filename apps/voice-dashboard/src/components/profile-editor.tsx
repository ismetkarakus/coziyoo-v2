"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { ModelTab } from "@/components/tabs/model-tab";
import { ToolsTab } from "@/components/tabs/tools-tab";
import { TranscriberTab } from "@/components/tabs/transcriber-tab";
import { VoiceTab } from "@/components/tabs/voice-tab";
import { useProfile, useUpdateProfile } from "@/lib/hooks/use-profiles";
import { profileFormSchema, type ProfileFormValues } from "@/lib/schemas/profile";
import type { AgentProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, val]) => {
    if (typeof val === "string") {
      acc[key] = val;
    }
    return acc;
  }, {});
}

export function mapProfileToFormValues(profile: AgentProfile): ProfileFormValues {
  const llm = asRecord(profile.llm_config);
  const tts = asRecord(profile.tts_config);
  const stt = asRecord(profile.stt_config);
  const n8n = asRecord(profile.n8n_config);

  return {
    name: profile.name,
    speaks_first: profile.speaks_first,
    system_prompt: profile.system_prompt ?? "",
    greeting_enabled: profile.greeting_enabled,
    greeting_instruction: profile.greeting_instruction ?? "",
    voice_language: profile.voice_language || "tr",
    llm_config: {
      base_url: asString(llm.base_url),
      api_key: asString(llm.api_key),
      model: asString(llm.model),
      endpoint_path: asString(llm.endpoint_path, "/v1/chat/completions"),
      custom_headers: asStringRecord(llm.custom_headers),
      custom_body_params: asStringRecord(llm.custom_body_params),
    },
    tts_config: {
      base_url: asString(tts.base_url),
      api_key: asString(tts.api_key),
      model: asString(tts.model),
      endpoint_path: asString(tts.endpoint_path, "/v1/audio/speech"),
      custom_headers: asStringRecord(tts.custom_headers),
      custom_body_params: asStringRecord(tts.custom_body_params),
      voice_id: asString(tts.voice_id),
      text_field_name: asString(tts.text_field_name, "input"),
    },
    stt_config: {
      base_url: asString(stt.base_url),
      api_key: asString(stt.api_key),
      model: asString(stt.model),
      endpoint_path: asString(stt.endpoint_path, "/v1/audio/transcriptions"),
      custom_headers: asStringRecord(stt.custom_headers),
      custom_body_params: asStringRecord(stt.custom_body_params),
      language: asString(stt.language),
      custom_query_params: asStringRecord(stt.custom_query_params),
    },
    n8n_config: {
      base_url: asString(n8n.base_url),
      webhook_path: asString(n8n.webhook_path),
      mcp_webhook_path: asString(n8n.mcp_webhook_path),
    },
  };
}

export function ProfileEditor({ profileId }: { profileId: string }) {
  const { data: profile, isLoading } = useProfile(profileId);
  const updateProfile = useUpdateProfile();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema) as any,
    defaultValues: {
      name: "",
      speaks_first: false,
      system_prompt: "",
      greeting_enabled: true,
      greeting_instruction: "",
      voice_language: "tr",
      llm_config: {
        base_url: "",
        api_key: "",
        model: "",
        endpoint_path: "/v1/chat/completions",
        custom_headers: {},
        custom_body_params: {},
      },
      tts_config: {
        base_url: "",
        api_key: "",
        model: "",
        endpoint_path: "/v1/audio/speech",
        custom_headers: {},
        custom_body_params: {},
        voice_id: "",
        text_field_name: "input",
      },
      stt_config: {
        base_url: "",
        api_key: "",
        model: "",
        endpoint_path: "/v1/audio/transcriptions",
        custom_headers: {},
        custom_body_params: {},
        language: "",
        custom_query_params: {},
      },
      n8n_config: {
        base_url: "",
        webhook_path: "",
        mcp_webhook_path: "",
      },
    },
  });

  useEffect(() => {
    if (profile) {
      form.reset(mapProfileToFormValues(profile));
    }
  }, [form, profile]);

  const onSubmit = (values: ProfileFormValues) => {
    updateProfile.mutate(
      { id: profileId, data: values as unknown as Partial<AgentProfile> },
      {
        onSuccess: () => toast.success("Profile saved"),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save profile"),
      },
    );
  };

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading profile...</div>;
  }

  if (!profile) {
    return <div className="p-8 text-sm text-muted-foreground">Profile not found.</div>;
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{profile.name}</h1>
        <Button type="submit" disabled={updateProfile.isPending}>
          {updateProfile.isPending ? "Saving..." : "Save"}
        </Button>
      </div>

      <div className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="profile-name">Profile Name</Label>
          <Input id="profile-name" {...form.register("name")} />
        </div>
      </div>

      <Tabs defaultValue="model" className="w-full">
        <TabsList>
          <TabsTrigger value="model">Model</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="transcriber">Transcriber</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
        </TabsList>
        <TabsContent value="model">
          <ModelTab control={form.control} register={form.register} watch={form.watch} setValue={form.setValue} />
        </TabsContent>
        <TabsContent value="voice">
          <VoiceTab control={form.control} register={form.register} watch={form.watch} setValue={form.setValue} />
        </TabsContent>
        <TabsContent value="transcriber">
          <TranscriberTab
            control={form.control}
            register={form.register}
            watch={form.watch}
            setValue={form.setValue}
          />
        </TabsContent>
        <TabsContent value="tools">
          <ToolsTab control={form.control} register={form.register} watch={form.watch} setValue={form.setValue} />
        </TabsContent>
      </Tabs>
    </form>
  );
}
