"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/api";
import { getAdmin } from "@/lib/auth";
import type { AdminUser } from "@/lib/types";
import { Button } from "@/components/ui/button";

export default function DashboardHomePage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminUser | null>(null);

  useEffect(() => {
    setAdmin(getAdmin());
  }, []);

  async function onLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Voice Dashboard</h1>
      <p className="text-sm text-muted-foreground">Welcome, {admin?.email ?? "admin"}.</p>
      <Button variant="outline" onClick={onLogout}>
        Log out
      </Button>
    </div>
  );
}
