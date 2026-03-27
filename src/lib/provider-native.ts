import type {
  CostSnapshotDto,
  ProviderFetchResultDto,
  ProviderId,
  ProviderUsageSnapshot,
  ProviderUsageWindow,
  QuotaCategory,
  RateWindowDto,
  TokenQuota,
} from "@/types";

export function buildProviderUsageSnapshot(
  providerId: ProviderId,
  result: ProviderFetchResultDto
): ProviderUsageSnapshot {
  if (
    providerId === "iflow" ||
    providerId === "vertexai" ||
    providerId === "qwen"
  ) {
    return {
      windows: [],
      headlineWindowId: undefined,
    };
  }

  const windows: ProviderUsageWindow[] = [];

  windows.push(
    createRateWindow(providerId, "primary", result.usage.primary, getWindowLabel(providerId, "primary", result.usage.primary))
  );

  if (result.usage.secondary) {
    windows.push(
      createRateWindow(
        providerId,
        "secondary",
        result.usage.secondary,
        getWindowLabel(providerId, "secondary", result.usage.secondary)
      )
    );
  }

  if (result.usage.model_specific) {
    windows.push(
      createRateWindow(
        providerId,
        "model_specific",
        result.usage.model_specific,
        getWindowLabel(providerId, "model_specific", result.usage.model_specific)
      )
    );
  }

  for (const extraWindow of result.usage.extra_windows ?? []) {
    windows.push(createExtraWindow(providerId, extraWindow));
  }

  if (result.cost) {
    windows.push(createCostWindow(providerId, result.cost));
  }

  return {
    windows,
    headlineWindowId: chooseHeadlineWindowId(windows),
  };
}

export function usageSnapshotToLegacyQuotas(snapshot: ProviderUsageSnapshot): QuotaCategory[] {
  return snapshot.windows.map((window) => ({
    name: window.label,
    kind: window.kind,
    quota: window.quota,
  }));
}

function createRateWindow(
  providerId: ProviderId,
  role: "primary" | "secondary" | "model_specific",
  source: RateWindowDto,
  label: string
): ProviderUsageWindow {
  const used = Math.round(Math.max(0, Math.min(100, source.used_percent)));
  const remaining = Math.max(0, 100 - used);
  const quota: TokenQuota = {
    used,
    total: 100,
    unlimited: false,
    unit: "%",
    displayMode: "progress",
    valueLabel: `${remaining}% remaining`,
    resetsAt: source.resets_at,
    remaining,
    remainingPercent: remaining,
  };

  return {
    id: `${providerId}:${role}`,
    name: label,
    label,
    role,
    kind: role === "model_specific" ? "model" : "window",
    official: true,
    quota,
  };
}

function createCostWindow(providerId: ProviderId, cost: CostSnapshotDto): ProviderUsageWindow {
  const symbol =
    cost.currency_code === "USD"
      ? "$"
      : cost.currency_code === "EUR"
        ? "EUR "
        : `${cost.currency_code} `;

  let quota: TokenQuota;
  if (cost.limit != null && cost.limit > 0) {
    const usedPct = Math.min(100, (cost.used / cost.limit) * 100);
    quota = {
      used: Math.round(usedPct),
      total: 100,
      unlimited: false,
      unit: "%",
      displayMode: "progress",
      valueLabel: `${symbol}${cost.used.toFixed(2)} / ${symbol}${cost.limit.toFixed(2)}`,
      resetsAt: cost.resets_at,
      remaining: Math.max(0, cost.limit - cost.used),
      remainingPercent: Math.max(0, 100 - usedPct),
    };
  } else {
    quota = {
      used: cost.used,
      total: 0,
      unlimited: false,
      unit: cost.currency_code,
      displayMode: "stat",
      valueLabel: `${symbol}${cost.used.toFixed(2)}`,
    };
  }

  const label = getCostLabel(providerId, cost.period);

  return {
    id: `${providerId}:cost:${cost.period.toLowerCase()}`,
    name: label,
    label,
    role: "cost",
    kind: "cost",
    official: true,
    quota,
  };
}

function createExtraWindow(
  providerId: ProviderId,
  source: NonNullable<ProviderFetchResultDto["usage"]["extra_windows"]>[number]
): ProviderUsageWindow {
  const used = Math.round(Math.max(0, Math.min(100, source.window.used_percent)));
  const remaining = Math.max(0, 100 - used);
  const quota: TokenQuota = {
    used,
    total: 100,
    unlimited: false,
    unit: "%",
    displayMode: "progress",
    valueLabel: `${remaining}% remaining`,
    resetsAt: source.window.resets_at,
    remaining,
    remainingPercent: remaining,
  };

  return {
    id: `${providerId}:extra:${source.id}`,
    name: source.label,
    label: source.label,
    role: "custom",
    kind: source.kind ?? "usage",
    official: true,
    quota,
  };
}

function getWindowLabel(
  providerId: ProviderId,
  role: "primary" | "secondary" | "model_specific",
  window: RateWindowDto
): string {
  switch (providerId) {
    case "codex":
      if (role === "primary") return formatDurationLabel(window, "Session window");
      if (role === "secondary") return "Weekly usage window";
      return "Model-specific access";
    case "copilot":
      if (role === "primary") return "Premium requests";
      return role === "secondary" ? "Copilot Chat" : "Feature access";
    case "cursor":
      if (role === "primary") return "Included plan usage";
      if (role === "secondary") return "Workspace usage";
      return "Model usage";
    case "trae":
      if (role === "primary") return "Advanced model usage";
      if (role === "secondary") return "Premium usage";
      return "Provider usage";
    case "claude":
      if (role === "primary") return formatDurationLabel(window, "Session window");
      if (role === "secondary") return "7-day window";
      return "Model-specific window";
    case "gemini":
    case "antigravity":
      return role === "primary"
        ? "Most constrained quota"
        : role === "secondary"
          ? "Secondary quota"
          : "Model spotlight";
    default:
      if (role === "secondary") {
        return window.window_minutes && window.window_minutes >= 60 * 24 * 6
          ? "Weekly window"
          : formatDurationLabel(window, "Secondary window");
      }
      if (role === "model_specific") {
        return "Model-specific window";
      }
      return formatDurationLabel(window, "Primary window");
  }
}

function getCostLabel(providerId: ProviderId, period: string): string {
  switch (providerId) {
    case "cursor":
      return "Usage-based spend";
    case "codex":
      return "Prepaid credits";
    default:
      return `Cost (${period})`;
  }
}

function formatDurationLabel(window: RateWindowDto, fallback: string): string {
  if (window.window_minutes) {
    if (window.window_minutes % (60 * 24 * 7) === 0) {
      const weeks = window.window_minutes / (60 * 24 * 7);
      return `${weeks}-week window`;
    }
    if (window.window_minutes % (60 * 24) === 0) {
      const days = window.window_minutes / (60 * 24);
      return `${days}-day window`;
    }
    if (window.window_minutes % 60 === 0) {
      const hours = window.window_minutes / 60;
      return `${hours}-hour window`;
    }
    return `${window.window_minutes}-minute window`;
  }

  return fallback;
}

function chooseHeadlineWindowId(windows: ProviderUsageWindow[]): string | undefined {
  const progressWindows = windows.filter(
    (window) => window.quota.displayMode !== "stat" && window.quota.total > 0
  );

  const candidatePool = progressWindows.length > 0 ? progressWindows : windows;
  return [...candidatePool]
    .sort((left, right) => {
      const leftRemaining = left.quota.remainingPercent ?? 101;
      const rightRemaining = right.quota.remainingPercent ?? 101;
      return leftRemaining - rightRemaining;
    })[0]?.id;
}
