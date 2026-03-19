import { useEffect, useMemo, useState } from "react";
import type { ApiKeyProviderId, ApiKeyVaultEntry } from "@/lib/api-key-vault";

const STORAGE_KEY = "tokenflow-api-key-vault";

type ApiKeyVaultState = Partial<Record<ApiKeyProviderId, ApiKeyVaultEntry>>;

function readApiKeyVault(): ApiKeyVaultState {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as ApiKeyVaultState;
  } catch {
    return {};
  }
}

export function useApiKeyVault() {
  const [entries, setEntries] = useState<ApiKeyVaultState>(readApiKeyVault);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  return useMemo(
    () => ({
      entries,
      saveEntry: (
        provider: ApiKeyProviderId,
        entry: Pick<ApiKeyVaultEntry, "label" | "apiKey" | "baseUrl">
      ) =>
        setEntries((current) => ({
          ...current,
          [provider]: {
            provider,
            label: entry.label.trim(),
            apiKey: entry.apiKey.trim(),
            baseUrl: entry.baseUrl.trim(),
            updatedAt: new Date().toISOString(),
            lastCopiedAt: current[provider]?.lastCopiedAt,
          },
        })),
      removeEntry: (provider: ApiKeyProviderId) =>
        setEntries((current) => {
          const next = { ...current };
          delete next[provider];
          return next;
        }),
      markCopied: (provider: ApiKeyProviderId) =>
        setEntries((current) => {
          const existing = current[provider];
          if (!existing) {
            return current;
          }

          return {
            ...current,
            [provider]: {
              ...existing,
              lastCopiedAt: new Date().toISOString(),
            },
          };
        }),
    }),
    [entries]
  );
}
