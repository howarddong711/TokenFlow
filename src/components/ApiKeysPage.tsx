import { type ReactNode, useState } from "react";
import { Copy, Eye, EyeOff, PencilLine, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  API_KEY_PROVIDER_MAP,
  CHINA_API_KEY_PROVIDERS,
  GLOBAL_API_KEY_PROVIDERS,
  type ApiKeyProviderId,
  type ApiKeyProviderMeta,
  type ApiKeyVaultEntry,
} from "@/lib/api-key-vault";
import { cn } from "@/lib/utils";
import { getWorkspaceCopy } from "@/i18n/workspaceCopy";

interface ApiKeysPageProps {
  copy: ReturnType<typeof getWorkspaceCopy>;
  entries: Partial<Record<ApiKeyProviderId, ApiKeyVaultEntry>>;
  onSaveEntry: (
    provider: ApiKeyProviderId,
    entry: Pick<ApiKeyVaultEntry, "label" | "apiKey" | "baseUrl">
  ) => void;
  onRemoveEntry: (provider: ApiKeyProviderId) => void;
  onMarkCopied: (provider: ApiKeyProviderId) => void;
}

type ApiKeyDraft = {
  label: string;
  apiKey: string;
  baseUrl: string;
};

const EMPTY_DRAFT: ApiKeyDraft = {
  label: "",
  apiKey: "",
  baseUrl: "",
};

export function ApiKeysPage({
  copy,
  entries,
  onSaveEntry,
  onRemoveEntry,
  onMarkCopied,
}: ApiKeysPageProps) {
  const [editingProviderId, setEditingProviderId] = useState<ApiKeyProviderId | null>(null);
  const [draft, setDraft] = useState<ApiKeyDraft>(EMPTY_DRAFT);
  const [revealed, setRevealed] = useState<Partial<Record<ApiKeyProviderId, boolean>>>({});
  const [copiedProviderId, setCopiedProviderId] = useState<ApiKeyProviderId | null>(null);

  const configuredCount = Object.values(entries).filter((entry) => Boolean(entry?.apiKey)).length;
  const editingProvider = editingProviderId ? API_KEY_PROVIDER_MAP[editingProviderId] : null;

  const openEditor = (providerId: ApiKeyProviderId) => {
    const existing = entries[providerId];
    setEditingProviderId(providerId);
    setDraft({
      label: existing?.label ?? "",
      apiKey: existing?.apiKey ?? "",
      baseUrl: existing?.baseUrl ?? "",
    });
  };

  const closeEditor = () => {
    setEditingProviderId(null);
    setDraft(EMPTY_DRAFT);
  };

  const handleSave = () => {
    if (!editingProviderId || !draft.apiKey.trim()) {
      return;
    }

    onSaveEntry(editingProviderId, draft);
    closeEditor();
  };

  const handleRemove = (providerId: ApiKeyProviderId) => {
    if (!window.confirm(copy.apiKeys.clearConfirm(API_KEY_PROVIDER_MAP[providerId].name))) {
      return;
    }

    onRemoveEntry(providerId);
    setRevealed((current) => ({
      ...current,
      [providerId]: false,
    }));
  };

  const handleCopy = async (providerId: ApiKeyProviderId) => {
    const apiKey = entries[providerId]?.apiKey;
    if (!apiKey) {
      return;
    }

    await navigator.clipboard.writeText(apiKey);
    onMarkCopied(providerId);
    setCopiedProviderId(providerId);
    window.setTimeout(() => setCopiedProviderId((current) => (current === providerId ? null : current)), 1800);
  };

  const toggleReveal = (providerId: ApiKeyProviderId) => {
    setRevealed((current) => ({
      ...current,
      [providerId]: !current[providerId],
    }));
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/90">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm leading-6 text-muted-foreground">{copy.apiKeys.subtitle}</p>
            <p className="text-xs text-muted-foreground">{copy.apiKeys.localOnly}</p>
          </div>
          <div className="inline-flex items-center rounded-full border border-primary/18 bg-primary/8 px-4 py-2 text-sm font-medium text-primary">
            {copy.apiKeys.storedCount(configuredCount, GLOBAL_API_KEY_PROVIDERS.length + CHINA_API_KEY_PROVIDERS.length)}
          </div>
        </CardContent>
      </Card>

      <ApiKeySection
        title={copy.apiKeys.globalGroup}
        providers={GLOBAL_API_KEY_PROVIDERS}
        entries={entries}
        copy={copy}
        revealed={revealed}
        copiedProviderId={copiedProviderId}
        onOpenEditor={openEditor}
        onToggleReveal={toggleReveal}
        onCopy={handleCopy}
        onRemove={handleRemove}
      />

      <ApiKeySection
        title={copy.apiKeys.chinaGroup}
        providers={CHINA_API_KEY_PROVIDERS}
        entries={entries}
        copy={copy}
        revealed={revealed}
        copiedProviderId={copiedProviderId}
        onOpenEditor={openEditor}
        onToggleReveal={toggleReveal}
        onCopy={handleCopy}
        onRemove={handleRemove}
      />

      <Dialog open={editingProvider !== null} onOpenChange={(open) => (!open ? closeEditor() : null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingProvider ? copy.apiKeys.dialogTitle(editingProvider.name) : copy.apiKeys.title}
            </DialogTitle>
            <DialogDescription>{copy.apiKeys.dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <FieldBlock label={copy.apiKeys.provider}>
              <input
                value={editingProvider?.name ?? ""}
                readOnly
                className="flex h-10 w-full rounded-xl border border-border/70 bg-muted/35 px-3 text-sm text-foreground outline-none"
              />
            </FieldBlock>

            <FieldBlock label={copy.apiKeys.label}>
              <input
                value={draft.label}
                onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                placeholder={copy.apiKeys.labelPlaceholder}
                className="flex h-10 w-full rounded-xl border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
              />
            </FieldBlock>

            <FieldBlock label={copy.apiKeys.apiKey}>
              <textarea
                value={draft.apiKey}
                onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder={copy.apiKeys.apiKeyPlaceholder}
                className="min-h-28 w-full rounded-xl border border-border/70 bg-background px-3 py-2 font-mono text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
              />
            </FieldBlock>

            <FieldBlock label={copy.apiKeys.baseUrl}>
              <input
                value={draft.baseUrl}
                onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                placeholder={copy.apiKeys.baseUrlPlaceholder}
                className="flex h-10 w-full rounded-xl border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
              />
            </FieldBlock>

            <p className="text-xs text-muted-foreground">{copy.apiKeys.saveDescription}</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEditor}>
              {copy.common.close}
            </Button>
            <Button onClick={handleSave} disabled={!draft.apiKey.trim()}>
              {copy.apiKeys.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApiKeySection({
  title,
  providers,
  entries,
  copy,
  revealed,
  copiedProviderId,
  onOpenEditor,
  onToggleReveal,
  onCopy,
  onRemove,
}: {
  title: string;
  providers: ApiKeyProviderMeta[];
  entries: Partial<Record<ApiKeyProviderId, ApiKeyVaultEntry>>;
  copy: ReturnType<typeof getWorkspaceCopy>;
  revealed: Partial<Record<ApiKeyProviderId, boolean>>;
  copiedProviderId: ApiKeyProviderId | null;
  onOpenEditor: (providerId: ApiKeyProviderId) => void;
  onToggleReveal: (providerId: ApiKeyProviderId) => void;
  onCopy: (providerId: ApiKeyProviderId) => Promise<void>;
  onRemove: (providerId: ApiKeyProviderId) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="px-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {providers.map((provider) => {
          const entry = entries[provider.id];
          const isRevealed = Boolean(revealed[provider.id]);
          const hasApiKey = Boolean(entry?.apiKey);

          return (
            <Card key={provider.id} className="border-border/70 bg-card/90">
              <CardContent className="flex h-full flex-col p-5">
                <div className="flex flex-col items-center text-center">
                  <ProviderMark provider={provider} />
                  <p className="mt-4 text-lg font-semibold tracking-tight text-foreground">
                    {provider.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry?.label || copy.apiKeys.emptyState}
                  </p>
                </div>

                <div className="mt-5 space-y-3 text-sm">
                  <InfoRow label={copy.apiKeys.provider} value={provider.name} />
                  <InfoRow label={copy.apiKeys.label} value={entry?.label || copy.apiKeys.notSet} />
                  <InfoRow
                    label={copy.apiKeys.baseUrl}
                    value={entry?.baseUrl || copy.apiKeys.notSet}
                    mono={Boolean(entry?.baseUrl)}
                  />
                  <InfoRow
                    label={copy.apiKeys.apiKey}
                    value={
                      hasApiKey
                        ? isRevealed
                          ? entry?.apiKey ?? ""
                          : maskApiKey(entry?.apiKey ?? "")
                        : copy.apiKeys.notSet
                    }
                    mono={hasApiKey}
                  />
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => onOpenEditor(provider.id)}>
                    {hasApiKey ? <PencilLine className="size-4" /> : <Plus className="size-4" />}
                    {hasApiKey ? copy.apiKeys.edit : copy.apiKeys.add}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onToggleReveal(provider.id)}
                    disabled={!hasApiKey}
                  >
                    {isRevealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    {isRevealed ? copy.apiKeys.hideKey : copy.apiKeys.showKey}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void onCopy(provider.id)}
                    disabled={!hasApiKey}
                  >
                    <Copy className="size-4" />
                    {copiedProviderId === provider.id ? copy.apiKeys.copied : copy.apiKeys.copyKey}
                  </Button>
                  {hasApiKey ? (
                    <Button size="sm" variant="outline" onClick={() => onRemove(provider.id)}>
                      <Trash2 className="size-4" />
                      {copy.apiKeys.clear}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function ProviderMark({ provider }: { provider: ApiKeyProviderMeta }) {
  return (
    <div
      className="flex size-20 items-center justify-center rounded-[24px] border border-border/70 bg-card shadow-[0_18px_48px_rgba(15,23,42,0.08)]"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${provider.color} 18%, var(--card)) 0%, var(--card) 100%)`,
      }}
    >
      {provider.iconProviderId ? (
        <ProviderIcon providerId={provider.iconProviderId} size={40} />
      ) : (
        <span
          className="inline-flex size-11 items-center justify-center rounded-2xl text-sm font-semibold uppercase ring-1 ring-black/10"
          style={{
            backgroundColor: `color-mix(in srgb, ${provider.color} 18%, white)`,
            color: `color-mix(in srgb, ${provider.color} 78%, black)`,
          }}
        >
          {provider.monogram}
        </span>
      )}
    </div>
  );
}

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3">
      <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "break-all text-sm text-foreground",
          mono && "font-mono text-[12px] leading-5"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function maskApiKey(value: string) {
  if (value.length <= 10) {
    return "•".repeat(Math.max(6, value.length));
  }

  return `${value.slice(0, 6)}${"•".repeat(Math.max(6, value.length - 10))}${value.slice(-4)}`;
}
