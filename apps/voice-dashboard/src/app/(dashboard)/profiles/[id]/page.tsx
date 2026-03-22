"use client";

import { useParams } from "next/navigation";

import { ProfileEditor } from "@/components/profile-editor";

export default function ProfileDetailPage() {
  const params = useParams<{ id: string }>();
  return <ProfileEditor profileId={params.id} />;
}
