"use client";

import { AuthGuard } from "@/components/auth-guard";
import { ProfileSidebar } from "@/components/profile-sidebar";
import { QueryProvider } from "@/providers/query-provider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <QueryProvider>
        <div className="flex min-h-screen">
          <ProfileSidebar />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </QueryProvider>
    </AuthGuard>
  );
}
