import type { ProviderAccount, ProviderUsageWindow, QuotaCategory, TokenQuota } from "@/types";

export type RiskLevel = "healthy" | "warning" | "critical" | "offline" | "error";

const PROGRESS_THRESHOLD_WARNING = 35;
const PROGRESS_THRESHOLD_CRITICAL = 15;

export function getQuotaRemainingPercent(quota: TokenQuota): number | null {
  if (quota.unlimited) {
    return 100;
  }

  if (typeof quota.remainingPercent === "number") {
    return clampPercent(quota.remainingPercent);
  }

  if (quota.displayMode === "progress" && quota.total > 0) {
    const usedPercent = (quota.used / quota.total) * 100;
    return clampPercent(100 - usedPercent);
  }

  return null;
}

export function getQuotaUsedPercent(quota: TokenQuota): number | null {
  if (quota.unlimited) {
    return 0;
  }

  if (quota.displayMode === "progress" && quota.total > 0) {
    return clampPercent((quota.used / quota.total) * 100);
  }

  const remaining = getQuotaRemainingPercent(quota);
  if (remaining == null) {
    return null;
  }

  return clampPercent(100 - remaining);
}

export function getQuotaRiskLevel(category: QuotaCategory): RiskLevel {
  const remaining = getQuotaRemainingPercent(category.quota);
  if (remaining == null) {
    return "healthy";
  }
  if (remaining <= PROGRESS_THRESHOLD_CRITICAL) {
    return "critical";
  }
  if (remaining <= PROGRESS_THRESHOLD_WARNING) {
    return "warning";
  }
  return "healthy";
}

export function getAccountRiskLevel(account: ProviderAccount): RiskLevel {
  if (account.authStatus === "error") {
    return "error";
  }
  if (account.authStatus !== "connected") {
    return "offline";
  }
  if (
    account.sessionHealth === "expired" ||
    account.sessionHealth === "invalid"
  ) {
    return "critical";
  }
  if (account.sessionHealth === "stale") {
    return "warning";
  }

  let risk: RiskLevel = "healthy";
  for (const window of getAccountUsageWindows(account)) {
    const nextRisk = getQuotaRiskLevel({ name: window.label, quota: window.quota, kind: window.kind });
    if (nextRisk === "critical") {
      return "critical";
    }
    if (nextRisk === "warning") {
      risk = "warning";
    }
  }

  return risk;
}

export function getAccountUsageWindows(account: ProviderAccount): ProviderUsageWindow[] {
  return account.usage?.windows ?? account.quotas.map((quota, index) => ({
    id: `${account.accountId}:legacy:${index}`,
    name: quota.name,
    label: quota.name,
    role: "custom",
    quota: quota.quota,
    kind: quota.kind,
    official: false,
  }));
}

export function getHeadlineUsageWindow(account: ProviderAccount): ProviderUsageWindow | null {
  const windows = getAccountUsageWindows(account);
  if (windows.length === 0) {
    return null;
  }

  if (account.usage?.headlineWindowId) {
    const explicit = windows.find((window) => window.id === account.usage?.headlineWindowId);
    if (explicit) {
      return explicit;
    }
  }

  const progressWindows = windows.filter(
    (item) => item.quota.displayMode !== "stat" && item.quota.total > 0
  );
  if (progressWindows.length === 0) {
    return windows[0];
  }

  return [...progressWindows].sort((left, right) => {
    const leftRemaining = getQuotaRemainingPercent(left.quota) ?? 101;
    const rightRemaining = getQuotaRemainingPercent(right.quota) ?? 101;
    return leftRemaining - rightRemaining;
  })[0];
}

export function getHeadlineQuota(account: ProviderAccount): QuotaCategory | null {
  const window = getHeadlineUsageWindow(account);
  if (!window) {
    return null;
  }

  return {
    name: window.label,
    kind: window.kind,
    quota: window.quota,
  };
}

export function getConnectedAccounts(accounts: ProviderAccount[]): ProviderAccount[] {
  return accounts.filter((account) => account.authStatus === "connected");
}

export function getAttentionAccounts(accounts: ProviderAccount[]): ProviderAccount[] {
  return [...accounts]
    .filter((account) => {
      const risk = getAccountRiskLevel(account);
      return risk === "critical" || risk === "warning" || risk === "error";
    })
    .sort((left, right) => compareRisk(getAccountRiskLevel(left), getAccountRiskLevel(right)));
}

export function getConnectionLabel(account: ProviderAccount): string {
  if (account.accountAuthKind) {
    return formatAuthKind(account.accountAuthKind);
  }
  if (account.sourceLabel) {
    return formatSourceLabel(account.sourceLabel);
  }
  return "Unknown Source";
}

export function formatSourceLabel(sourceLabel: string): string {
  const normalized = sourceLabel.trim().toLowerCase();
  const labelMap: Record<string, string> = {
    oauth: "OAuth API",
    web: "Web Session",
    api: "API",
    cli: "CLI",
    local: "Local Probe",
    "openai-web": "OpenAI Web",
    "codex-cli": "Codex CLI",
    "browser_cookie": "Browser Cookie",
    "manual_cookie": "Manual Cookie",
  };

  if (labelMap[normalized]) {
    return labelMap[normalized];
  }

  if (normalized.includes("oauth")) {
    return "OAuth API";
  }
  if (normalized.includes("cookie") || normalized.includes("web")) {
    return "Web Session";
  }
  if (normalized.includes("cli")) {
    return "CLI";
  }
  if (normalized.includes("local")) {
    return "Local Probe";
  }
  if (normalized.includes("api")) {
    return "API";
  }

  return sourceLabel;
}

export function formatAuthKind(
  authKind: ProviderAccount["accountAuthKind"]
): string {
  switch (authKind) {
    case "oauth_token":
      return "OAuth";
    case "api_key":
      return "API Key";
    case "service_account_json":
      return "Service Account";
    case "manual_cookie":
      return "Manual Cookie";
    case "browser_profile_cookie":
      return "Browser Profile";
    case "imported_cli_oauth":
      return "CLI Import";
    case "local_detected":
      return "Auto Detected";
    default:
      return "Unknown Source";
  }
}

export function formatResetTime(resetsAt?: string): string | null {
  if (!resetsAt) {
    return null;
  }

  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const now = Date.now();
  const diffMs = date.getTime() - now;
  if (diffMs <= 0) {
    return "Resets soon";
  }

  const totalMinutes = Math.round(diffMs / 60000);
  if (totalMinutes < 60) {
    return `Resets in ${totalMinutes}m`;
  }

  const totalHours = Math.round(totalMinutes / 60);
  if (totalHours < 48) {
    return `Resets in ${totalHours}h`;
  }

  const totalDays = Math.round(totalHours / 24);
  return `Resets in ${totalDays}d`;
}

export function formatLastFetchedAt(timestamp?: string): string {
  if (!timestamp) {
    return "Never synced";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Never synced";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes < 1) {
    return "Updated just now";
  }
  if (diffMinutes < 60) {
    return `Updated ${diffMinutes}m ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`;
  }

  return `Updated ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function compareRisk(left: RiskLevel, right: RiskLevel): number {
  return riskWeight(right) - riskWeight(left);
}

function riskWeight(risk: RiskLevel): number {
  switch (risk) {
    case "critical":
      return 4;
    case "error":
      return 3;
    case "warning":
      return 2;
    case "offline":
      return 1;
    case "healthy":
    default:
      return 0;
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
