"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { useProfile, useUpdateProfile } from "@/lib/hooks/use-profiles";
import { profileFormSchema, type ProfileFormValues } from "@/lib/schemas/profile";
import type { AgentProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

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
        <div className="space-y-2">
          <Label htmlFor="system-prompt">System Prompt</Label>
          <Textarea id="system-prompt" rows={4} {...form.register("system_prompt")} />
        </div>
        <div className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
          <div>
            <p className="text-sm font-medium">Speaks first</p>
            <p className="text-xs text-muted-foreground">Agent starts the conversation automatically.</p>
          </div>
          <Controller
            control={form.control}
            name="speaks_first"
            render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />}
          />
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
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">Model tab content (Plan 03)</div>
        </TabsContent>
        <TabsContent value="voice">
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">Voice tab content (Plan 03)</div>
        </TabsContent>
        <TabsContent value="transcriber">
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">
            Transcriber tab content (Plan 03)
          </div>
        </TabsContent>
        <TabsContent value="tools">
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">Tools tab content (Plan 03)</div>
        </TabsContent>
      </Tabs>
    </form>
  );
}
