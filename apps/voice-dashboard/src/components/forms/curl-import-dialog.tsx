"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Download } from "lucide-react";
import { parseCurlCommand, type ParsedCurlResult } from "@/lib/utils/curl-parser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type CurlImportDialogProps = {
  onImport: (parsed: ParsedCurlResult) => void;
};

export function CurlImportDialog({ onImport }: CurlImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<ParsedCurlResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasPreview = useMemo(() => parsed && Object.keys(parsed).length > 0, [parsed]);

  const handleParseAndImport = () => {
    try {
      const result = parseCurlCommand(raw);
      if (!result.base_url) {
        throw new Error("No valid URL found in cURL command.");
      }
      setParsed(result);
      setError(null);
      onImport(result);
    } catch (parseError) {
      setParsed(null);
      setError(parseError instanceof Error ? parseError.message : "Unable to parse cURL command.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Download className="size-4" />
          Import from cURL
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import server config from cURL</DialogTitle>
          <DialogDescription>
            Paste a cURL command, parse it, and import supported fields into the form.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Textarea
            rows={8}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            placeholder="curl https://api.example.com/v1/audio/speech -H 'Authorization: Bearer sk-...'"
          />
          {error && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" />
              {error}
            </p>
          )}
        </div>

        {hasPreview && (
          <div className="max-h-48 overflow-auto rounded-lg border p-2 text-xs">
            <pre>{JSON.stringify(parsed, null, 2)}</pre>
          </div>
        )}

        <DialogFooter>
          <Button type="button" onClick={handleParseAndImport}>
            Parse & Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
