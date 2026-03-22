"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useProfiles } from "@/lib/hooks/use-profiles";

export default function ProfilesPage() {
  const { data: profiles, isLoading } = useProfiles();
  const router = useRouter();

  useEffect(() => {
    if (profiles && profiles.length > 0) {
      router.replace(`/profiles/${profiles[0].id}`);
    }
  }, [profiles, router]);

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading profiles...</div>;
  }

  if (!profiles || profiles.length === 0) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">No profiles yet. Create one from the sidebar.</p>
      </div>
    );
  }

  return <div className="p-8 text-sm text-muted-foreground">Redirecting to profile editor...</div>;
}
