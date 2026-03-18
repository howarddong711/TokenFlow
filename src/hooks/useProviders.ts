import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildProviderUsageSnapshot, usageSnapshotToLegacyQuotas } from "@/lib/provider-native";
import type { ProviderAccount, ProviderFetchResultDto, ProviderId } from "@/types";
import { PROVIDERS } from "@/types";
import { openInBrowser } from "@/services/browser";

const REFRESH_INTERVAL_MS = 60 * 1000;

interface ProviderResultEntry {
  provider: string;
  ok: boolean;
  result?: ProviderFetchResultDto;
  error?: string;
  browser_label?: string;
}

interface AllProvidersResponse {
  providers: ProviderResultEntry[];
}

type AccountOverride = {
  alias?: string;
  isDefault?: boolean;
};

type AccountOverrideMap = Record<string, AccountOverride>;

function entryToAccount(
  entry: ProviderResultEntry,
  overrides: AccountOverrideMap
): ProviderAccount {
  const providerId = entry.provider as ProviderId;
  const accountId = entry.browser_label
    ? `${entry.provider}::${entry.browser_label}`
    : entry.provider;
  const override_ = overrides[accountId];

  if (!entry.ok || !entry.result) {
    const isDisabled = entry.error?.includes("not enabled by default") ?? false;
    return {
      accountId,
      providerId,
      authStatus: isDisabled ? "disconnected" : "error",
      alias: override_?.alias ?? entry.browser_label ?? undefined,
      browserLabel: entry.browser_label,
      isDefault: override_?.isDefault ?? true,
      error: isDisabled ? undefined : (entry.error ?? "Unknown error"),
      quotas: [],
      usage: { windows: [] },
    };
  }

  const result = entry.result;
  const usage = buildProviderUsageSnapshot(providerId, result);

  return {
    accountId,
    providerId,
    authStatus: "connected",
    alias:
      override_?.alias ??
      result.usage.account_email ??
      entry.browser_label ??
      result.usage.account_organization ??
      undefined,
    isDefault: override_?.isDefault ?? true,
    email: result.usage.account_email,
    browserLabel: entry.browser_label,
    subscription: result.usage.login_method
      ? { plan: result.usage.login_method, status: "active" }
      : { plan: result.source_label, status: "active" },
    usage,
    quotas: usageSnapshotToLegacyQuotas(usage),
    lastFetchedAt: result.usage.updated_at,
    sourceLabel: result.source_label,
  };
}

export interface DeviceFlowState {
  status: "idle" | "awaiting_code" | "polling" | "success" | "error";
  userCode?: string;
  verificationUri?: string;
  error?: string;
  pollAttempt?: number;
}

export interface UseProvidersReturn {
  accounts: ProviderAccount[];
  deviceFlow: DeviceFlowState;
  isRestoring: boolean;
  refreshProvider: (accountId: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  connectProvider: (providerId: ProviderId) => Promise<void>;
  renameAccount: (accountId: string, alias: string) => void;
  setDefaultAccount: (accountId: string) => void;
  updateAccount: (accountId: string, update: Partial<ProviderAccount>) => void;
}

export function useProviders(): UseProvidersReturn {
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [isRestoring, setIsRestoring] = useState(true);
  const [overrides, setOverrides] = useState<AccountOverrideMap>({});
  const overridesRef = useRef(overrides);
  const fetchInFlightRef = useRef(false);

  overridesRef.current = overrides;

  const fetchAll = useCallback(async () => {
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;

    try {
      const response = await invoke<AllProvidersResponse>("fetch_all_providers_usage");
      const next = response.providers.map((entry) =>
        entryToAccount(entry, overridesRef.current)
      );
      setAccounts(next);
    } catch (err) {
      console.error("[useProviders] fetch_all_providers_usage failed:", err);
    } finally {
      fetchInFlightRef.current = false;
    }
  }, []);

  const refreshProvider = useCallback(async (accountId: string) => {
    try {
      const providerId = accountId.includes("::") ? accountId.split("::")[0] : accountId;
      const result = await invoke<ProviderFetchResultDto>("fetch_provider_usage", {
        providerId,
      });

      const updated = entryToAccount(
        {
          provider: providerId,
          ok: true,
          result,
        },
        overridesRef.current
      );
      updated.accountId = accountId;

      setAccounts((prev) =>
        prev.map((account) => (account.accountId === accountId ? updated : account))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAccounts((prev) =>
        prev.map((account) =>
          account.accountId === accountId
            ? { ...account, authStatus: "error", error: message }
            : account
        )
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        await fetchAll();
      } finally {
        if (!cancelled) {
          setIsRestoring(false);
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  useEffect(() => {
    if (isRestoring) return;

    const interval = window.setInterval(() => {
      void fetchAll().catch(() => {});
    }, REFRESH_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void fetchAll().catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [isRestoring, fetchAll]);

  const updateAccount = useCallback((accountId: string, update: Partial<ProviderAccount>) => {
    setAccounts((prev) =>
      prev.map((account) => (account.accountId === accountId ? { ...account, ...update } : account))
    );
  }, []);

  const renameAccount = useCallback((accountId: string, alias: string) => {
    const trimmed = alias.trim() || undefined;
    setOverrides((prev) => ({
      ...prev,
      [accountId]: { ...prev[accountId], alias: trimmed },
    }));
    setAccounts((prev) =>
      prev.map((account) => (account.accountId === accountId ? { ...account, alias: trimmed } : account))
    );
  }, []);

  const setDefaultAccount = useCallback((accountId: string) => {
    setAccounts((prev) => {
      const target = prev.find((account) => account.accountId === accountId);
      if (!target) return prev;
      return prev.map((account) =>
        account.providerId === target.providerId
          ? { ...account, isDefault: account.accountId === accountId }
          : account
      );
    });

    setOverrides((prev) => {
      const target = accounts.find((account) => account.accountId === accountId);
      if (!target) return prev;
      const next = { ...prev };
      for (const account of accounts) {
        if (account.providerId === target.providerId) {
          next[account.accountId] = {
            ...next[account.accountId],
            isDefault: account.accountId === accountId,
          };
        }
      }
      return next;
    });
  }, [accounts]);

  const connectProvider = useCallback(async (providerId: ProviderId) => {
    try {
      const result = await invoke<ProviderFetchResultDto>("fetch_provider_usage", {
        providerId,
      });

      const updated = entryToAccount(
        {
          provider: providerId,
          ok: true,
          result,
        },
        overridesRef.current
      );

      setAccounts((prev) => {
        const exists = prev.some((account) => account.accountId === providerId);
        if (exists) {
          return prev.map((account) => (account.accountId === providerId ? updated : account));
        }
        return prev.map((account) =>
          account.providerId === providerId && account.accountId.startsWith("placeholder-")
            ? updated
            : account
        );
      });
    } catch {
      const meta = PROVIDERS[providerId];
      if (meta?.portalUrl) {
        void openInBrowser(meta.portalUrl);
      }
    }
  }, []);

  return {
    accounts,
    deviceFlow: { status: "idle" },
    isRestoring,
    refreshProvider,
    refreshAll: fetchAll,
    connectProvider,
    renameAccount,
    setDefaultAccount,
    updateAccount,
  };
}
