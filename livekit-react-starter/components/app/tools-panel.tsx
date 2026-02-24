'use client';

import { useEffect, useMemo, useState } from 'react';
import { Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

type ToolItem = {
  id: string;
  name: string;
  description?: string;
  webhookPath?: string | null;
  method?: string;
};

type RegistryResponse = {
  data?: {
    tools?: ToolItem[];
  };
};

type StatusResponse = {
  data?: {
    configured?: boolean;
    reachable?: boolean;
  };
};

interface ToolsPanelProps {
  roomName?: string;
  username?: string;
}

export function ToolsPanel({ roomName, username }: ToolsPanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningToolId, setRunningToolId] = useState<string | null>(null);
  const [inputByToolId, setInputByToolId] = useState<Record<string, string>>({});
  const [lastRunMessage, setLastRunMessage] = useState('');
  const [status, setStatus] = useState<{ configured: boolean; reachable: boolean }>({
    configured: false,
    reachable: false,
  });

  const statusLabel = useMemo(() => {
    if (!status.configured) return t('n8nNotConfigured');
    return status.reachable
      ? `${t('n8nConfigured')} - ${t('n8nReachable')}`
      : `${t('n8nConfigured')} - ${t('n8nUnreachable')}`;
  }, [status, t]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statusRes, registryRes] = await Promise.all([
        fetch('/api/starter/tools/status', { method: 'GET' }),
        fetch('/api/starter/tools/registry', { method: 'GET' }),
      ]);

      const statusJson = (await statusRes.json().catch(() => ({}))) as StatusResponse;
      const registryJson = (await registryRes.json().catch(() => ({}))) as RegistryResponse;

      setStatus({
        configured: Boolean(statusJson.data?.configured),
        reachable: Boolean(statusJson.data?.reachable),
      });
      setTools(Array.isArray(registryJson.data?.tools) ? registryJson.data!.tools! : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  const runTool = async (tool: ToolItem) => {
    setRunningToolId(tool.id);
    try {
      const response = await fetch('/api/starter/tools/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          toolId: tool.id,
          input: inputByToolId[tool.id] ?? '',
          roomName,
          username,
        }),
      });

      if (!response.ok) {
        throw new Error(t('runFailed'));
      }
      setLastRunMessage(t('runOk'));
    } catch {
      setLastRunMessage(t('runFailed'));
    } finally {
      setRunningToolId(null);
    }
  };

  return (
    <div className="fixed right-4 bottom-28 z-40">
      <Button
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-full"
        size="icon"
        variant={open ? 'default' : 'secondary'}
        aria-label={t('tools')}
      >
        <Wrench className="size-4" />
      </Button>

      {open && (
        <div className="bg-background border-input mt-2 w-[340px] max-w-[90vw] rounded-2xl border p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{t('tools')}</p>
              <p className="text-muted-foreground text-xs">{t('toolsDescription')}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => loadData()} disabled={loading}>
              {t('refreshTools')}
            </Button>
          </div>

          <p className="text-muted-foreground mb-3 text-xs">{statusLabel}</p>
          {lastRunMessage ? <p className="mb-3 text-xs">{lastRunMessage}</p> : null}

          <div className="max-h-[45vh] space-y-2 overflow-auto pr-1">
            {tools.length === 0 && (
              <p className="text-muted-foreground text-xs">{t('noToolsFound')}</p>
            )}
            {tools.map((tool) => (
              <div key={tool.id} className="border-input rounded-xl border p-2">
                <p className="text-sm font-medium">{tool.name}</p>
                {tool.description ? (
                  <p className="text-muted-foreground mt-0.5 text-xs">{tool.description}</p>
                ) : null}
                <textarea
                  value={inputByToolId[tool.id] ?? ''}
                  onChange={(event) =>
                    setInputByToolId((prev) => ({
                      ...prev,
                      [tool.id]: event.target.value,
                    }))
                  }
                  placeholder={t('toolInputPlaceholder')}
                  className="bg-background border-input mt-2 min-h-16 w-full rounded-lg border p-2 text-xs"
                />
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => runTool(tool)}
                  disabled={runningToolId === tool.id || !status.configured}
                >
                  {runningToolId === tool.id ? t('running') : t('runTool')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
