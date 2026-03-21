import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { Copy, PencilLine, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  SORTED_API_KEY_PROVIDERS,
  type ApiKeyProviderId,
  type ApiKeyProviderMeta,
  type ApiKeyVaultEntry,
  type ApiKeyVaultEntryInput,
} from "@/lib/api-key-vault";
import { cn } from "@/lib/utils";
import { getWorkspaceCopy } from "@/i18n/workspaceCopy";

interface ApiKeysPageProps {
  copy: ReturnType<typeof getWorkspaceCopy>;
  entries: ApiKeyVaultEntry[];
  onCreateEntry: (entry: ApiKeyVaultEntryInput) => void;
  onUpdateEntry: (entryId: string, entry: ApiKeyVaultEntryInput) => void;
  onRemoveEntry: (entryId: string) => void;
  onMarkCopied: (entryId: string) => void;
}

type ApiKeyDraft = ApiKeyVaultEntryInput;

const EMPTY_DRAFT: ApiKeyDraft = {
  provider: "openai",
  label: "",
  apiKey: "",
  baseUrl: "",
  models: [],
};

const API_KEY_LAYOUT_STORAGE_KEY = "tokenflow-api-key-layout-debug";

type ApiKeyLayoutDebug = {
  providerCol: number;
  labelCol: number;
  apiKeyCol: number;
  baseUrlCol: number;
  modelsCol: number;
  actionsCol: number;
  columnGap: number;
  rowPaddingX: number;
  rowPaddingY: number;
  providerIconSize: number;
  providerNameSize: number;
  bodyFontSize: number;
  monoFontSize: number;
  actionButtonHeight: number;
  actionFontSize: number;
  actionGap: number;
};

const DEFAULT_API_KEY_LAYOUT: ApiKeyLayoutDebug = {
  providerCol: 120,
  labelCol: 54,
  apiKeyCol: 148,
  baseUrlCol: 164,
  modelsCol: 74,
  actionsCol: 212,
  columnGap: 10,
  rowPaddingX: 12,
  rowPaddingY: 12,
  providerIconSize: 40,
  providerNameSize: 12,
  bodyFontSize: 12,
  monoFontSize: 12,
  actionButtonHeight: 28,
  actionFontSize: 11,
  actionGap: 4,
};

function readApiKeyLayoutDebug(): ApiKeyLayoutDebug {
  if (typeof window === "undefined") {
    return DEFAULT_API_KEY_LAYOUT;
  }

  const raw = window.localStorage.getItem(API_KEY_LAYOUT_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_API_KEY_LAYOUT;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ApiKeyLayoutDebug>;
    return {
      ...DEFAULT_API_KEY_LAYOUT,
      ...parsed,
    };
  } catch {
    return DEFAULT_API_KEY_LAYOUT;
  }
}

export function ApiKeysPage({
  copy,
  entries,
  onCreateEntry,
  onUpdateEntry,
  onRemoveEntry,
  onMarkCopied,
}: ApiKeysPageProps) {
  const [layoutDebug] = useState<ApiKeyLayoutDebug>(readApiKeyLayoutDebug);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [viewingModelsEntryId, setViewingModelsEntryId] = useState<string | null>(null);
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ApiKeyDraft>(EMPTY_DRAFT);
  const [modelsText, setModelsText] = useState("");
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null);
  const [copiedModelKey, setCopiedModelKey] = useState<string | null>(null);

  const editingEntry = useMemo(
    () => entries.find((entry) => entry.id === editingEntryId) ?? null,
    [editingEntryId, entries]
  );
  const sortedEntries = useMemo(
    () =>
      [...entries].sort((left, right) => {
        const providerDelta = API_KEY_PROVIDER_MAP[left.provider].name.localeCompare(
          API_KEY_PROVIDER_MAP[right.provider].name,
          "zh-Hans-CN",
          { sensitivity: "base" }
        );
        if (providerDelta !== 0) {
          return providerDelta;
        }

        const labelDelta = left.label.localeCompare(right.label, "zh-Hans-CN", {
          sensitivity: "base",
        });
        if (labelDelta !== 0) {
          return labelDelta;
        }

        return right.updatedAt.localeCompare(left.updatedAt);
      }),
    [entries]
  );
  const selectedProvider = API_KEY_PROVIDER_MAP[draft.provider];
  const configuredCount = sortedEntries.length;
  const tableGridStyle = useMemo<CSSProperties>(
    () => ({
      gridTemplateColumns: `${layoutDebug.providerCol}px ${layoutDebug.labelCol}px ${layoutDebug.apiKeyCol}px ${layoutDebug.baseUrlCol}px ${layoutDebug.modelsCol}px ${layoutDebug.actionsCol}px`,
      columnGap: `${layoutDebug.columnGap}px`,
    }),
    [layoutDebug]
  );
  const viewingModelsEntry = useMemo(
    () => sortedEntries.find((entry) => entry.id === viewingModelsEntryId) ?? null,
    [sortedEntries, viewingModelsEntryId]
  );
  const pendingDeleteEntry = useMemo(
    () => sortedEntries.find((entry) => entry.id === pendingDeleteEntryId) ?? null,
    [pendingDeleteEntryId, sortedEntries]
  );

  const openCreateDialog = () => {
    setEditingEntryId(null);
    setDraft({ ...EMPTY_DRAFT });
    setModelsText("");
    setDialogOpen(true);
  };

  const openEditDialog = (entry: ApiKeyVaultEntry) => {
    setEditingEntryId(entry.id);
    setDraft({
      provider: entry.provider,
      label: entry.label,
      apiKey: entry.apiKey,
      baseUrl: entry.baseUrl,
      models: entry.models,
    });
    setModelsText(entry.models.join("\n"));
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingEntryId(null);
    setDraft({ ...EMPTY_DRAFT });
    setModelsText("");
  };

  const handleSave = () => {
    if (!draft.apiKey.trim()) {
      return;
    }

    const payload = {
      ...draft,
      models: splitModels(modelsText),
    };

    if (editingEntry) {
      onUpdateEntry(editingEntry.id, payload);
    } else {
      onCreateEntry(payload);
    }

    closeDialog();
  };

  const handleCopy = async (entry: ApiKeyVaultEntry) => {
    await navigator.clipboard.writeText(entry.apiKey);
    onMarkCopied(entry.id);
    setCopiedEntryId(entry.id);
    window.setTimeout(() => {
      setCopiedEntryId((current) => (current === entry.id ? null : current));
    }, 1800);
  };

  const handleCopyModel = async (entryId: string, model: string) => {
    await navigator.clipboard.writeText(model);
    const key = `${entryId}:${model}`;
    setCopiedModelKey(key);
    window.setTimeout(() => {
      setCopiedModelKey((current) => (current === key ? null : current));
    }, 1800);
  };

  const handleRemove = (entry: ApiKeyVaultEntry) => {
    setPendingDeleteEntryId(entry.id);
  };

  const openModelsDialog = (entry: ApiKeyVaultEntry) => {
    setViewingModelsEntryId(entry.id);
  };

  const closeModelsDialog = () => {
    setViewingModelsEntryId(null);
  };

  const closeDeleteDialog = () => {
    setPendingDeleteEntryId(null);
  };

  const confirmDelete = () => {
    if (!pendingDeleteEntry) {
      return;
    }

    onRemoveEntry(pendingDeleteEntry.id);
    closeDeleteDialog();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/72 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{copy.apiKeys.localOnly}</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="inline-flex items-center rounded-full border border-border/70 bg-muted/35 px-3 py-1.5 text-xs font-medium text-foreground">
            {copy.apiKeys.storedCount(configuredCount)}
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="size-4" />
            {copy.apiKeys.add}
          </Button>
        </div>
      </div>

      {sortedEntries.length === 0 ? (
        <Card className="border-dashed border-border/70 bg-card/70">
          <CardContent className="flex min-h-[300px] flex-col items-center justify-center gap-4 px-6 py-10 text-center">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight">{copy.apiKeys.emptyState}</h2>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                {copy.apiKeys.dialogDescription}
              </p>
            </div>
            <Button onClick={openCreateDialog}>
              <Plus className="size-4" />
              {copy.apiKeys.add}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/70 bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold">{copy.apiKeys.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className="grid rounded-2xl border border-border/60 bg-muted/35 px-3 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground"
              style={tableGridStyle}
            >
              <span>{copy.apiKeys.provider}</span>
              <span>{copy.apiKeys.label}</span>
              <span>{copy.apiKeys.apiKey}</span>
              <span>{copy.apiKeys.baseUrl}</span>
              <span>{copy.apiKeys.models}</span>
              <span>{copy.apiKeys.actions}</span>
            </div>

            {sortedEntries.map((entry) => {
              const provider = API_KEY_PROVIDER_MAP[entry.provider];

              return (
                <ApiKeyRow
                  key={entry.id}
                  entry={entry}
                  provider={provider}
                  copy={copy}
                  copied={copiedEntryId === entry.id}
                  layout={layoutDebug}
                  tableGridStyle={tableGridStyle}
                  onEdit={() => openEditDialog(entry)}
                  onCopy={() => void handleCopy(entry)}
                  onViewModels={() => openModelsDialog(entry)}
                  onRemove={() => handleRemove(entry)}
                />
              );
            })}
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => (!open ? closeDialog() : setDialogOpen(true))}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{copy.apiKeys.dialogTitle(selectedProvider.name)}</DialogTitle>
            <DialogDescription>{copy.apiKeys.dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <FieldBlock label={copy.apiKeys.provider}>
              <select
                value={draft.provider}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    provider: event.target.value as ApiKeyProviderId,
                  }))
                }
                className="flex h-10 w-full rounded-xl border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
              >
                {SORTED_API_KEY_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
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

            <FieldBlock label={copy.apiKeys.models}>
              <textarea
                value={modelsText}
                onChange={(event) => setModelsText(event.target.value)}
                placeholder={copy.apiKeys.modelsPlaceholder}
                className="min-h-24 w-full rounded-xl border border-border/70 bg-background px-3 py-2 font-mono text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
              />
            </FieldBlock>

            <p className="text-xs text-muted-foreground">{copy.apiKeys.saveDescription}</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {copy.common.close}
            </Button>
            <Button onClick={handleSave} disabled={!draft.apiKey.trim()}>
              {copy.apiKeys.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDeleteEntry !== null} onOpenChange={(open) => (!open ? closeDeleteDialog() : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.apiKeys.deleteTitle}</DialogTitle>
            <DialogDescription>
              {pendingDeleteEntry
                ? copy.apiKeys.clearConfirm(API_KEY_PROVIDER_MAP[pendingDeleteEntry.provider].name)
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeDeleteDialog}>
              {copy.common.close}
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              {copy.apiKeys.deleteConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewingModelsEntry !== null} onOpenChange={(open) => (!open ? closeModelsDialog() : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {viewingModelsEntry
                ? copy.apiKeys.dialogTitle(API_KEY_PROVIDER_MAP[viewingModelsEntry.provider].name)
                : copy.apiKeys.models}
            </DialogTitle>
            <DialogDescription>{copy.apiKeys.modelsDialogDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {viewingModelsEntry?.models.length ? (
              viewingModelsEntry.models.map((model) => {
                const modelKey = `${viewingModelsEntry.id}:${model}`;
                const copiedModel = copiedModelKey === modelKey;

                return (
                  <div
                    key={model}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/60 px-4 py-3"
                  >
                    <span className="break-all font-mono text-sm text-foreground">{model}</span>
                    <Button size="sm" variant="outline" onClick={() => void handleCopyModel(viewingModelsEntry.id, model)}>
                      <Copy className="size-4" />
                      {copiedModel ? copy.apiKeys.copied : copy.apiKeys.copyModel}
                    </Button>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-6 text-sm text-muted-foreground">
                null
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModelsDialog}>
              {copy.common.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApiKeyRow({
  entry,
  provider,
  copy,
  copied,
  layout,
  tableGridStyle,
  onEdit,
  onCopy,
  onViewModels,
  onRemove,
}: {
  entry: ApiKeyVaultEntry;
  provider: ApiKeyProviderMeta;
  copy: ReturnType<typeof getWorkspaceCopy>;
  copied: boolean;
  layout: ApiKeyLayoutDebug;
  tableGridStyle: CSSProperties;
  onEdit: () => void;
  onCopy: () => void;
  onViewModels: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="rounded-2xl border border-border/70 bg-background/55"
      style={{
        paddingInline: `${layout.rowPaddingX}px`,
        paddingBlock: `${layout.rowPaddingY}px`,
      }}
    >
      <div className="grid items-center" style={tableGridStyle}>
        <div className="flex min-w-0 items-center justify-center">
          <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
            <ProviderMark provider={provider} size={layout.providerIconSize} />
            <p
              className="w-full truncate font-medium text-foreground"
              style={{ fontSize: `${layout.providerNameSize}px` }}
            >
              {provider.name}
            </p>
          </div>
        </div>

        <Cell>
          <span
            className="truncate text-foreground"
            style={{ fontSize: `${layout.bodyFontSize}px` }}
          >
            {entry.label || "null"}
          </span>
        </Cell>

        <Cell>
          <span
            className="break-all font-mono leading-5 text-foreground"
            style={{ fontSize: `${layout.monoFontSize}px` }}
          >
            {maskApiKey(entry.apiKey)}
          </span>
        </Cell>

        <Cell>
          <span
            className={cn(
              "break-all text-foreground",
              entry.baseUrl && "font-mono leading-5"
            )}
            style={{
              fontSize: `${entry.baseUrl ? layout.monoFontSize : layout.bodyFontSize}px`,
            }}
          >
            {entry.baseUrl || copy.apiKeys.notSet}
          </span>
        </Cell>

        <Cell>
          {entry.models.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="whitespace-nowrap px-2"
              style={{
                height: `${layout.actionButtonHeight}px`,
                fontSize: `${layout.actionFontSize}px`,
              }}
              onClick={onViewModels}
            >
              {copy.apiKeys.viewModels(entry.models.length)}
            </Button>
          ) : (
            <span
              className="text-foreground"
              style={{ fontSize: `${layout.bodyFontSize}px` }}
            >
              null
            </span>
          )}
        </Cell>

        <div
          className="flex items-center justify-end whitespace-nowrap"
          style={{ gap: `${layout.actionGap}px` }}
        >
          <Button
            size="sm"
            variant="outline"
            className="whitespace-nowrap px-1.5"
            style={{
              height: `${layout.actionButtonHeight}px`,
              fontSize: `${layout.actionFontSize}px`,
            }}
            onClick={onEdit}
          >
            <PencilLine className="size-4" />
            {copy.apiKeys.edit}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="whitespace-nowrap px-1.5"
            style={{
              height: `${layout.actionButtonHeight}px`,
              fontSize: `${layout.actionFontSize}px`,
            }}
            onClick={onCopy}
          >
            <Copy className="size-4" />
            {copied ? copy.apiKeys.copied : copy.apiKeys.copyKey}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="whitespace-nowrap px-1.5"
            style={{
              height: `${layout.actionButtonHeight}px`,
              fontSize: `${layout.actionFontSize}px`,
            }}
            onClick={onRemove}
          >
            <Trash2 className="size-4" />
            {copy.apiKeys.clear}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProviderMark({
  provider,
  size,
}: {
  provider: ApiKeyProviderMeta;
  size: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center border border-border/70 bg-card shadow-[0_10px_26px_rgba(15,23,42,0.08)]"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${provider.color} 18%, var(--card)) 0%, var(--card) 100%)`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${Math.max(12, Math.round(size * 0.32))}px`,
      }}
    >
      {provider.iconSrc ? (
        <img
          src={provider.iconSrc}
          alt=""
          aria-hidden="true"
          width={Math.max(18, Math.round(size * 0.58))}
          height={Math.max(18, Math.round(size * 0.58))}
          className="object-contain"
        />
      ) : provider.iconProviderId ? (
        <ProviderIcon providerId={provider.iconProviderId} size={Math.max(18, Math.round(size * 0.58))} />
      ) : (
        <span
          className="inline-flex items-center justify-center font-semibold uppercase ring-1 ring-black/10"
          style={{
            backgroundColor: `color-mix(in srgb, ${provider.color} 18%, white)`,
            color: `color-mix(in srgb, ${provider.color} 78%, black)`,
            width: `${Math.max(18, Math.round(size * 0.58))}px`,
            height: `${Math.max(18, Math.round(size * 0.58))}px`,
            borderRadius: `${Math.max(8, Math.round(size * 0.24))}px`,
            fontSize: `${Math.max(10, Math.round(size * 0.22))}px`,
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

function Cell({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="min-w-0">{children}</div>;
}

function maskApiKey(value: string) {
  const mask = "*";

  if (value.length <= 10) {
    return mask.repeat(6);
  }

  return `${value.slice(0, 6)}${mask.repeat(6)}${value.slice(-4)}`;
}

function splitModels(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((model) => model.trim())
    .filter(Boolean);
}
