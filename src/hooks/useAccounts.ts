import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildProviderUsageSnapshot, usageSnapshotToLegacyQuotas } from "@/lib/provider-native";
import type {
  AccountDisplayDto,
  AccountRecordDto,
  AccountSecretInput,
  ProviderFetchResultDto,
  ProviderAccount,
  ProviderCapabilityDto,
  ProviderId,
} from "@/types";

const REFRESH_INTERVAL_MS = 60 * 1000;
const SYNC_ERROR_GRACE_MS = 2 * 60 * 1000;

interface AccountUsageResultDto {
  account: AccountRecordDto;
  ok: boolean;
  result?: ProviderFetchResultDto;
  error?: string;
}

export interface AddAccountRequest {
  providerId: ProviderId;
  label?: string;
  authKind: AccountRecordDto["auth_kind"];
  secret?: AccountSecretInput;
  display?: AccountDisplayDto;
  default?: boolean;
}

export interface UseAccountsReturn {
  accounts: ProviderAccount[];
  capabilities: Record<ProviderId, ProviderCapabilityDto | undefined>;
  isRestoring: boolean;
  refreshAccount: (accountId: string) => Promise<void>;
  repairCursorAccount: (accountId: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  addAccount: (input: AddAccountRequest) => Promise<ProviderAccount>;
  removeAccount: (accountId: string) => Promise<void>;
  renameAccount: (accountId: string, label: string) => Promise<void>;
  setDefaultAccount: (accountId: string) => Promise<void>;
}

function normalizeAccountAuthKind(input: AddAccountRequest): AccountRecordDto["auth_kind"] {
  if (
    input.authKind === "oauth_token" ||
    input.authKind === "api_key" ||
    input.authKind === "service_account_json" ||
    input.authKind === "manual_cookie" ||
    input.authKind === "browser_profile_cookie" ||
    input.authKind === "imported_cli_oauth" ||
    input.authKind === "local_detected"
  ) {
    return input.authKind;
  }

  switch (input.secret?.kind) {
    case "oauth":
      return "oauth_token";
    case "api_key":
      return "api_key";
    case "service_account_json":
      return "service_account_json";
    case "manual_cookie":
      return "manual_cookie";
    case "browser_profile_cookie":
      return "browser_profile_cookie";
    case "imported_cli_oauth":
      return "imported_cli_oauth";
    default:
      return "api_key";
  }
}

function usageResultToAccount(entry: AccountUsageResultDto): ProviderAccount {
  const { account } = entry;
  const result = entry.result;
  const email = result?.usage.account_email ?? account.display.email;
  const plan = result?.usage.login_method ?? account.display.plan;
  const usage = result ? buildProviderUsageSnapshot(account.provider_id, result) : undefined;

  return {
    accountId: account.id,
    providerId: account.provider_id,
    accountAuthKind: account.auth_kind,
    authStatus: entry.ok && result ? "connected" : entry.error ? "error" : "disconnected",
    alias: account.label,
    isDefault: account.default,
    username: account.display.username,
    email,
    organization: result?.usage.account_organization,
    browserLabel: account.display.browser_label,
    avatarUrl: account.display.avatar_url,
    subscription: plan
      ? { plan, status: "active" }
      : result
        ? { plan: result.source_label, status: "active" }
        : undefined,
    usage,
    quotas: usage ? usageSnapshotToLegacyQuotas(usage) : [],
    createdAt: account.created_at,
    lastFetchedAt: result?.usage.updated_at ?? account.updated_at,
    sourceLabel: result?.source_label,
    sessionHealth: account.display.session_health,
    sessionHealthReason: account.display.session_health_reason,
    sessionCheckedAt: account.display.session_checked_at,
    error: entry.ok ? undefined : entry.error,
  };
}

function authKindRequiresSecret(authKind: AccountRecordDto["auth_kind"]): boolean {
  return authKind !== "local_detected";
}

function storedAccountToFallback(entry: AccountRecordDto): ProviderAccount {
  const hasSavedCredential = Boolean(entry.secret_ref) || !authKindRequiresSecret(entry.auth_kind);
  const withinGrace = hasSavedCredential && isWithinSyncGrace(entry.updated_at);

  return {
    accountId: entry.id,
    providerId: entry.provider_id,
    accountAuthKind: entry.auth_kind,
    authStatus: hasSavedCredential ? (withinGrace ? "connected" : "error") : "disconnected",
    alias: entry.label,
    isDefault: entry.default,
    username: entry.display.username,
    email: entry.display.email,
    browserLabel: entry.display.browser_label,
    avatarUrl: entry.display.avatar_url,
    subscription: entry.display.plan
      ? { plan: entry.display.plan, status: "active" }
      : undefined,
    quotas: [],
    createdAt: entry.created_at,
    lastFetchedAt: entry.updated_at,
    sessionHealth: entry.display.session_health,
    sessionHealthReason:
      entry.display.session_health_reason ??
      (hasSavedCredential
        ? withinGrace
          ? "Using last successful sync while live refresh is still within the 2-minute grace period."
          : "Saved login found, but startup sync failed. Try refresh before reconnecting."
        : undefined),
    sessionCheckedAt: entry.display.session_checked_at,
    error: hasSavedCredential && !withinGrace
      ? "Saved login found, but live usage sync was unavailable after startup."
      : undefined,
  };
}

function isWithinSyncGrace(timestamp?: string): boolean {
  if (!timestamp) {
    return false;
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return Date.now() - date.getTime() <= SYNC_ERROR_GRACE_MS;
}

function preserveRecentAccountState(
  previous: ProviderAccount | undefined,
  result: AccountUsageResultDto
): ProviderAccount {
  const next = usageResultToAccount(result);
  const previousHadQuotaData =
    (previous?.usage?.windows.length ?? 0) > 0 || (previous?.quotas.length ?? 0) > 0;

  if (
    !previous ||
    result.ok ||
    !isWithinSyncGrace(previous.lastFetchedAt) ||
    !previousHadQuotaData
  ) {
    return next;
  }

  return {
    ...previous,
    alias: next.alias,
    isDefault: next.isDefault,
    username: next.username ?? previous.username,
    email: next.email ?? previous.email,
    browserLabel: next.browserLabel ?? previous.browserLabel,
    avatarUrl: next.avatarUrl ?? previous.avatarUrl,
    subscription: next.subscription ?? previous.subscription,
    authStatus: "connected",
    sessionHealth:
      previous.sessionHealth === "expired" || previous.sessionHealth === "invalid"
        ? previous.sessionHealth
        : "stale",
    sessionHealthReason:
      "Live refresh failed, but the last successful sync is still within the 2-minute grace period.",
    error: undefined,
  };
}

function mergeFetchedAccounts(
  previousAccounts: ProviderAccount[],
  results: AccountUsageResultDto[]
): ProviderAccount[] {
  const previousById = new Map(
    previousAccounts.map((account) => [account.accountId, account])
  );

  return results.map((result) =>
    preserveRecentAccountState(previousById.get(result.account.id), result)
  );
}

export function useAccounts(): UseAccountsReturn {
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [capabilityList, setCapabilityList] = useState<ProviderCapabilityDto[]>([]);
  const [isRestoring, setIsRestoring] = useState(true);
  const fetchInFlightRef = useRef(false);

  const capabilityMap = useMemo(
    () =>
      Object.fromEntries(
        capabilityList.map((capability) => [capability.provider, capability])
      ) as Record<ProviderId, ProviderCapabilityDto | undefined>,
    [capabilityList]
  );

  const fetchAll = useCallback(async () => {
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;

    try {
      const [usageRes, capabilitiesRes] = await Promise.allSettled([
        invoke<AccountUsageResultDto[]>("fetch_all_accounts_usage"),
        invoke<ProviderCapabilityDto[]>("list_provider_capabilities"),
      ]);

      if (usageRes.status === "fulfilled") {
        setAccounts((previous) => mergeFetchedAccounts(previous, usageRes.value));
      } else {
        console.error("[useAccounts] fetch_all_accounts_usage failed:", usageRes.reason);
        try {
          const storedAccounts = await invoke<AccountRecordDto[]>("list_accounts");
          setAccounts(storedAccounts.map(storedAccountToFallback));
        } catch (fallbackErr) {
          console.error("[useAccounts] list_accounts fallback failed:", fallbackErr);
        }
      }

      if (capabilitiesRes.status === "fulfilled") {
        setCapabilityList(capabilitiesRes.value);
      }
    } finally {
      fetchInFlightRef.current = false;
    }
  }, []);

  const refreshAccount = useCallback(async (accountId: string) => {
    const result = await invoke<AccountUsageResultDto>("fetch_account_usage", {
      accountId,
    });
    setAccounts((prev) => {
      const previous = prev.find((account) => account.accountId === accountId);
      const updated = preserveRecentAccountState(previous, result);
      return prev.map((account) =>
        account.accountId === accountId ? updated : account
      );
    });
  }, []);

  const addAccount = useCallback(async (input: AddAccountRequest) => {
    const created = await invoke<AccountRecordDto>("add_account", {
      input: {
        provider_id: input.providerId,
        label: input.label,
        auth_kind: normalizeAccountAuthKind(input),
        secret: input.secret,
        display: input.display ?? {},
        default: input.default ?? false,
      },
    });

    const refreshed = await invoke<AccountUsageResultDto>("fetch_account_usage", {
      accountId: created.id,
    });
    const updated = usageResultToAccount(refreshed);

    setAccounts((prev) => {
      const next = prev
        .filter((account) => account.accountId !== created.id)
        .map((account) =>
          updated.isDefault && account.providerId === updated.providerId
            ? { ...account, isDefault: false }
            : account
        );
      return [...next, updated];
    });

    void fetchAll();
    return updated;
  }, [fetchAll]);

  const repairCursorAccount = useCallback(async (accountId: string) => {
    const repaired = await invoke<AccountUsageResultDto>("repair_cursor_account_session", {
      accountId,
    });
    setAccounts((prev) => {
      const previous = prev.find((account) => account.accountId === accountId);
      const updated = preserveRecentAccountState(previous, repaired);
      return prev.map((account) =>
        account.accountId === accountId ? updated : account
      );
    });
    void fetchAll();
  }, [fetchAll]);

  const removeAccount = useCallback(async (accountId: string) => {
    await invoke("remove_account", { accountId });
    await fetchAll();
  }, [fetchAll]);

  const renameAccount = useCallback(async (accountId: string, label: string) => {
    const renamed = await invoke<AccountRecordDto>("rename_account", { accountId, label });
    setAccounts((prev) =>
      prev.map((account) =>
        account.accountId === accountId
          ? {
              ...account,
              alias: renamed.label,
            }
          : account
      )
    );
    void fetchAll();
  }, [fetchAll]);

  const setDefaultAccount = useCallback(async (accountId: string) => {
    await invoke("set_default_account", { accountId });
    await fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const [accountsRes, capabilitiesRes] = await Promise.allSettled([
        invoke<AccountRecordDto[]>("list_accounts"),
        invoke<ProviderCapabilityDto[]>("list_provider_capabilities"),
      ]);

      if (cancelled) return;

      if (accountsRes.status === "fulfilled") {
        setAccounts(accountsRes.value.map(storedAccountToFallback));
      }

      if (capabilitiesRes.status === "fulfilled") {
        setCapabilityList(capabilitiesRes.value);
      }

      setIsRestoring(false);

      void fetchAll().catch((err) => {
        console.error("[useAccounts] initial background refresh failed:", err);
      });
    };

    void init().catch((err) => {
      console.error("[useAccounts] init failed:", err);
      if (!cancelled) {
        setIsRestoring(false);
      }
    });

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

  return {
    accounts,
    capabilities: capabilityMap,
    isRestoring,
    refreshAccount,
    repairCursorAccount,
    refreshAll: fetchAll,
    addAccount,
    removeAccount,
    renameAccount,
    setDefaultAccount,
  };
}
