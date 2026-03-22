"use client";

import { AuthGuard } from "@/components/auth-guard";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <aside className="w-64 border-r bg-muted/40 p-4">
          <h2 className="mb-4 text-lg font-semibold">Voice Dashboard</h2>
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </AuthGuard>
  );
}
