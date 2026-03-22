"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { parseJson, request } from "@/lib/api";
import type { AgentProfile } from "@/lib/types";

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const res = await request("/v1/admin/agent-profiles");
      if (!res.ok) {
        throw new Error("Failed to fetch profiles");
      }
      const json = await parseJson<{ data: AgentProfile[] }>(res);
      return json.data;
    },
  });
}

export function useProfile(id: string) {
  return useQuery({
    queryKey: ["profiles", id],
    queryFn: async () => {
      const res = await request(`/v1/admin/agent-profiles/${id}`);
      if (!res.ok) {
        throw new Error("Failed to fetch profile");
      }
      const json = await parseJson<{ data: AgentProfile }>(res);
      return json.data;
    },
    enabled: Boolean(id),
  });
}

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await request("/v1/admin/agent-profiles", {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        throw new Error("Failed to create profile");
      }
      return (await parseJson<{ data: AgentProfile }>(res)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AgentProfile> }) => {
      const res = await request(`/v1/admin/agent-profiles/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        throw new Error("Failed to update profile");
      }
      return (await parseJson<{ data: AgentProfile }>(res)).data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["profiles"] });
      qc.invalidateQueries({ queryKey: ["profiles", id] });
    },
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await request(`/v1/admin/agent-profiles/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await parseJson<{ error?: { code?: string; message?: string } }>(res);
        throw new Error(err.error?.message ?? "Failed to delete profile");
      }
      return (await parseJson<{ data: { deleted: string } }>(res)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
}

export function useActivateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await request(`/v1/admin/agent-profiles/${id}/activate`, { method: "POST" });
      if (!res.ok) {
        throw new Error("Failed to activate profile");
      }
      return (await parseJson<{ data: { active: string } }>(res)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
}

export function useDuplicateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await request(`/v1/admin/agent-profiles/${id}/duplicate`, { method: "POST" });
      if (!res.ok) {
        throw new Error("Failed to duplicate profile");
      }
      return (await parseJson<{ data: AgentProfile }>(res)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
}
