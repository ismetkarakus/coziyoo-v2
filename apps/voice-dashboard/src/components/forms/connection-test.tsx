"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ConnectionTestProps = {
  status: "idle" | "testing" | "success" | "error";
  detail?: string;
  onTest: () => void;
  label?: string;
};

export function ConnectionTest({
  status,
  detail,
  onTest,
  label = "Test Connection",
}: ConnectionTestProps) {
  return (
    <div className="space-y-2">
      <Button type="button" onClick={onTest} disabled={status === "testing"}>
        {status === "testing" ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Testing...
          </>
        ) : (
          label
        )}
      </Button>

      {status === "success" && (
        <Badge variant="secondary" className="gap-1.5">
          <CheckCircle2 className="size-3.5" />
          {detail ?? "Connection successful"}
        </Badge>
      )}

      {status === "error" && (
        <Badge variant="destructive" className="gap-1.5">
          <XCircle className="size-3.5" />
          {detail ?? "Connection failed"}
        </Badge>
      )}
    </div>
  );
}
