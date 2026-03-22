"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { parseJson, postJsonWith415Fallback, request } from "@/lib/api";
import { setAdmin, setTokens } from "@/lib/auth";
import type { AdminUser, ApiError, Tokens } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoginResponse = {
  data: {
    admin?: AdminUser;
    tokens: Tokens;
  };
  error?: {
    message?: string;
  };
};

type MeResponse = {
  data?: AdminUser;
} & Partial<AdminUser>;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@coziyoo.com");
  const [password, setPassword] = useState("Admin12345");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    try {
      const response = await postJsonWith415Fallback("/v1/admin/auth/login", { email, password });
      const json = await parseJson<LoginResponse>(response);

      if (response.status !== 200 || !json.data?.tokens) {
        toast.error(json.error?.message ?? "Login failed");
        return;
      }

      setTokens(json.data.tokens);
      let admin = json.data.admin ?? null;

      const meResp = await request("/v1/admin/auth/me");
      if (meResp.status === 200) {
        const me = await parseJson<MeResponse>(meResp);
        admin = me.data ?? (me.id ? (me as AdminUser) : admin);
      }

      if (!admin) {
        toast.error("Profile load failed");
        return;
      }

      setAdmin(admin);
      router.push("/dashboard");
    } catch (error) {
      const err = error as ApiError;
      toast.error(err.error?.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Voice Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <Button className="w-full" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
