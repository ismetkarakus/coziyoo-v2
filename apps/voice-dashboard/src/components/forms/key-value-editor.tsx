"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type KeyValueEditorProps = {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
};

type Entry = { key: string; value: string };

function normalizeEntries(source: Record<string, string>): Entry[] {
  const entries = Object.entries(source ?? {}).map(([key, value]) => ({ key, value }));
  return entries.length > 0 ? entries : [{ key: "", value: "" }];
}

function toRecord(entries: Entry[]): Record<string, string> {
  const nextValue: Record<string, string> = {};
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key) continue;
    nextValue[key] = entry.value;
  }
  return nextValue;
}

export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  addLabel = "Add",
}: KeyValueEditorProps) {
  const entries = normalizeEntries(value);

  const updateEntry = (index: number, field: keyof Entry, fieldValue: string) => {
    const updated = entries.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: fieldValue } : entry,
    );
    onChange(toRecord(updated));
  };

  const removeEntry = (index: number) => {
    const updated = entries.filter((_, entryIndex) => entryIndex !== index);
    onChange(toRecord(updated));
  };

  const addEntry = () => {
    onChange(toRecord([...entries, { key: "", value: "" }]));
  };

  return (
    <div className="space-y-2">
      {entries.map((entry, index) => (
        <div key={`${index}-${entry.key}`} className="flex items-center gap-2">
          <Input
            value={entry.key}
            onChange={(event) => updateEntry(index, "key", event.target.value)}
            placeholder={keyPlaceholder}
          />
          <Input
            value={entry.value}
            onChange={(event) => updateEntry(index, "value", event.target.value)}
            placeholder={valuePlaceholder}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => removeEntry(index)}
            aria-label="Delete row"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addEntry}>
        <Plus className="size-4" />
        {addLabel}
      </Button>
    </div>
  );
}
