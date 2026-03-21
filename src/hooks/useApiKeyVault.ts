import { useEffect, useMemo, useState } from "react";
import type {
  ApiKeyProviderId,
  ApiKeyVaultEntry,
  ApiKeyVaultEntryInput,
} from "@/lib/api-key-vault";

const STORAGE_KEY = "tokenflow-api-key-vault";

type LegacyApiKeyVaultState = Partial<Record<ApiKeyProviderId, Omit<ApiKeyVaultEntry, "id">>>;

function createVaultEntryId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `api-key-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeEntry(
  entry: ApiKeyVaultEntryInput,
  existing?: Partial<ApiKeyVaultEntry>
): ApiKeyVaultEntry {
  return {
    id: existing?.id ?? createVaultEntryId(),
    provider: entry.provider,
    label: entry.label.trim(),
    apiKey: entry.apiKey.trim(),
    baseUrl: entry.baseUrl.trim(),
    models: entry.models.map((model) => model.trim()).filter(Boolean),
    updatedAt: new Date().toISOString(),
    lastCopiedAt: existing?.lastCopiedAt,
  };
}

function migrateLegacyState(state: LegacyApiKeyVaultState) {
  return Object.values(state)
    .filter((entry): entry is Omit<ApiKeyVaultEntry, "id"> => Boolean(entry?.provider && entry.apiKey))
    .map((entry) =>
      normalizeEntry(
        {
          provider: entry.provider,
          label: entry.label ?? "",
          apiKey: entry.apiKey,
          baseUrl: entry.baseUrl ?? "",
          models: entry.models ?? [],
        },
        entry
      )
    );
}

function sortEntries(entries: ApiKeyVaultEntry[]) {
  return [...entries].sort((left, right) => {
    const updatedDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (!Number.isNaN(updatedDelta) && updatedDelta !== 0) {
      return updatedDelta;
    }

    return left.provider.localeCompare(right.provider);
  });
}

function readApiKeyVault(): ApiKeyVaultEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as ApiKeyVaultEntry[] | LegacyApiKeyVaultState;
    if (Array.isArray(parsed)) {
      return sortEntries(
        parsed.filter(
          (entry): entry is ApiKeyVaultEntry =>
            Boolean(entry?.id && entry.provider && typeof entry.apiKey === "string")
        )
        .map((entry) => ({
          ...entry,
          models: Array.isArray(entry.models) ? entry.models.filter((model) => typeof model === "string") : [],
        }))
      );
    }

    return sortEntries(migrateLegacyState(parsed));
  } catch {
    return [];
  }
}

export function useApiKeyVault() {
  const [entries, setEntries] = useState<ApiKeyVaultEntry[]>(readApiKeyVault);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  return useMemo(
    () => ({
      entries,
      createEntry: (entry: ApiKeyVaultEntryInput) =>
        setEntries((current) => sortEntries([...current, normalizeEntry(entry)])),
      updateEntry: (entryId: string, entry: ApiKeyVaultEntryInput) =>
        setEntries((current) =>
          sortEntries(
            current.map((existing) =>
              existing.id === entryId ? normalizeEntry(entry, existing) : existing
            )
          )
        ),
      removeEntry: (entryId: string) =>
        setEntries((current) => current.filter((entry) => entry.id !== entryId)),
      markCopied: (entryId: string) =>
        setEntries((current) =>
          current.map((entry) =>
            entry.id === entryId
              ? {
                  ...entry,
                  lastCopiedAt: new Date().toISOString(),
                }
              : entry
          )
        ),
    }),
    [entries]
  );
}
