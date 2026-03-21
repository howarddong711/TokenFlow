import { type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { ArrowUpDown, CheckCircle2, Columns2, Copy, Eye, EyeOff, FileClock, Layers3, PencilLine, Plus, RefreshCw, Rows3, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AboutPage } from "@/components/AboutPage";
import { AddAccountDialog } from "@/components/AddAccountDialog";
import { ApiKeysPage } from "@/components/ApiKeysPage";
import { ProviderColorBadge, ProviderIcon } from "@/components/ProviderIcon";
import { QuotaRing } from "@/components/QuotaRing";
import { SettingsPage } from "@/components/SettingsPage";
import { Sidebar, type WorkspacePageId } from "@/components/Sidebar";
import { UsageBars, type UsageBarsLayout } from "@/components/UsageBars";
import { useAccounts, useApiKeyVault, useAppUpdater, useLogCenter, useWorkspacePreferences } from "@/hooks";
import type {
  RequestDataSource,
} from "@/hooks/useLogCenter";
import { useTray } from "@/hooks/useTray";
import { useI18n } from "@/i18n";
import { getWorkspaceCopy } from "@/i18n/workspaceCopy";
import {
  buildMonthlyRequestBars,
  buildMonthlyTokenBars,
  formatCompactNumber,
  getDisplayAccountMeta,
  getDisplayAccountName,
  getProviderReportedTokenTotal,
  getProviderConnectionCount,
  readProviderReportedHistory,
  storeProviderReportedHistory,
  type ProviderReportedHistory,
} from "@/lib/workspace-analytics";
import {
  FOCUSED_PROVIDER_IDS,
  getFocusedAccounts,
  sortFocusedProviderIdsByUsage,
} from "@/lib/provider-focus";
import {
  formatLastFetchedAt,
  formatResetTime,
  getAttentionAccounts,
  getAccountRiskLevel,
  getAccountUsageWindows,
  getConnectedAccounts,
  getHeadlineUsageWindow,
  type RiskLevel,
} from "@/lib/monitoring";
import { cn } from "@/lib/utils";
import type { ProviderAccount, ProviderId } from "@/types";
import { PROVIDERS } from "@/types";

const APP_VERSION = "0.1.2";
type RequestStatusFilter = "all" | `${number}`;
const DASHBOARD_CHART_LAYOUT = {
  sectionGap: 8,
  legendGap: 4,
  legendBottomGap: 4,
  chartGap: 6,
  blockGap: 4,
  chartHeight: 148,
  plotHeight: 118,
  barWidth: 17,
};

const DEFAULT_ACCOUNT_CARD_LAYOUT = {
  cardPaddingY: 4,
  cardGap: 16,
  logoSize: 30,
  titleSize: 17,
  metaSize: 13,
  ringSize: 51,
  ringGap: 9,
  sideLabelSize: 14,
};

function sortAccountsByLoginOrder(accounts: ProviderAccount[]) {
  return [...accounts].sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : Number.POSITIVE_INFINITY;
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : Number.POSITIVE_INFINITY;

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return left.accountId.localeCompare(right.accountId);
  });
}

type AccountCardLayout = {
  cardPaddingY: number;
  cardGap: number;
  logoSize: number;
  titleSize: number;
  metaSize: number;
  ringSize: number;
  ringGap: number;
  sideLabelSize: number;
};

export function Dashboard() {
  const { lang } = useI18n();
  const copy = getWorkspaceCopy(lang);
  const {
    accounts,
    capabilities,
    isRestoring,
    refreshAll,
    addAccount,
    removeAccount,
    renameAccount,
  } = useAccounts();
  const { preferences, ...preferenceActions } = useWorkspacePreferences();
  const apiKeyVault = useApiKeyVault();
  const appUpdater = useAppUpdater(preferences.autoUpdate);
  const logCenter = useLogCenter();

  const focusedAccounts = useMemo(() => getFocusedAccounts(accounts), [accounts]);
  const connectedAccounts = useMemo(() => getConnectedAccounts(focusedAccounts), [focusedAccounts]);
  const [page, setPage] = useState<WorkspacePageId>("dashboard");
  const [providerTab, setProviderTab] = useState<ProviderId>("codex");
  const [addAccountProvider, setAddAccountProvider] = useState<ProviderId | null>(null);
  const [requestProviderFilter, setRequestProviderFilter] = useState<ProviderId | "all">("all");
  const [requestStatusFilter, setRequestStatusFilter] = useState<RequestStatusFilter>("all");
  const requestQuery = "";
  const [logTab, setLogTab] = useState<"requests" | "app">("requests");
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [providerReportedHistory, setProviderReportedHistory] =
    useState<ProviderReportedHistory>(readProviderReportedHistory);

  useTray(
    focusedAccounts,
    {
      inboxCount: logCenter.requestSummary.totalRequests,
      isQuietMode: false,
    },
    preferences.minimizeToTray
  );

  const providerColors = preferences.providerColors;
  const monthlyBars = useMemo(
    () =>
      buildMonthlyTokenBars(
        logCenter.requestLogs,
        providerColors,
        30,
        providerReportedHistory
      ),
    [logCenter.requestLogs, providerColors, providerReportedHistory]
  );
  const monthlyRequestBars = useMemo(
    () => buildMonthlyRequestBars(logCenter.requestLogs, providerColors, 30, providerReportedHistory),
    [logCenter.requestLogs, providerColors, providerReportedHistory]
  );
  const topMetrics = {
    totalAccounts: connectedAccounts.length,
    totalTokens: logCenter.requestSummary.totalTokens,
    totalRequests: logCenter.requestSummary.totalRequests,
    connectedProviders: getProviderConnectionCount(focusedAccounts),
  };
  const providerUsageTotals = useMemo(() => {
    const totals = new Map<ProviderId, number>();

    for (const providerId of FOCUSED_PROVIDER_IDS) {
      totals.set(providerId, 0);
    }

    for (const entry of logCenter.requestLogs) {
      totals.set(
        entry.providerId,
        (totals.get(entry.providerId) ?? 0) + entry.inputTokens + entry.outputTokens
      );
    }

    for (const provider of logCenter.providerReportedSummary.byProvider) {
      if ((totals.get(provider.providerId) ?? 0) > 0) {
        continue;
      }

      totals.set(
        provider.providerId,
        getProviderReportedTokenTotal(provider, logCenter.requestLogs)
      );
    }

    return totals;
  }, [logCenter.providerReportedSummary.byProvider, logCenter.requestLogs]);
  const visibleProviderIds = useMemo(() => {
    const ids = new Set<ProviderId>();

    for (const providerId of FOCUSED_PROVIDER_IDS) {
      if (connectedAccounts.some((account) => account.providerId === providerId)) {
        ids.add(providerId);
      }
      if (logCenter.requestLogs.some((entry) => entry.providerId === providerId)) {
        ids.add(providerId);
      }
    }

    if (ids.size === 0) {
      ids.add("codex");
    }

    return sortFocusedProviderIdsByUsage(
      FOCUSED_PROVIDER_IDS.filter((providerId) => ids.has(providerId)) as ProviderId[],
      (providerId) => providerUsageTotals.get(providerId) ?? 0
    );
  }, [connectedAccounts, logCenter.requestLogs, providerUsageTotals]);
  const providerSummaries = useMemo(
    () =>
      visibleProviderIds.map((providerId) => {
        const providerAccounts = sortAccountsByLoginOrder(
          connectedAccounts.filter((account) => account.providerId === providerId)
        );
        const providerLogs = logCenter.requestLogs.filter((entry) => entry.providerId === providerId);
        const providerReported = logCenter.providerReportedSummary.byProvider.find(
          (entry) => entry.providerId === providerId
        );
        return {
          providerId,
          providerAccounts,
          totalTokens:
            providerLogs.length > 0
              ? providerLogs.reduce(
                  (sum, entry) => sum + entry.inputTokens + entry.outputTokens,
                  0
                )
              : providerReported
                ? getProviderReportedTokenTotal(providerReported, logCenter.requestLogs)
                : 0,
          totalRequests:
            providerLogs.length > 0 ? providerLogs.length : providerReported?.totalRequests ?? 0,
          hasActivity: providerLogs.length > 0 || (providerReported?.totalRequests ?? 0) > 0,
        };
      }),
    [connectedAccounts, logCenter.providerReportedSummary.byProvider, logCenter.requestLogs, visibleProviderIds]
  );
  const providerTabIds = useMemo(
    () =>
      sortFocusedProviderIdsByUsage(
        [...FOCUSED_PROVIDER_IDS],
        (providerId) => providerUsageTotals.get(providerId) ?? 0
      ),
    [providerUsageTotals]
  );
  const providerPageSummaries = useMemo(
    () =>
      providerTabIds.map((providerId) => {
        const providerAccounts = sortAccountsByLoginOrder(
          connectedAccounts.filter((account) => account.providerId === providerId)
        );
        const providerLogs = logCenter.requestLogs.filter((entry) => entry.providerId === providerId);
        const providerReported = logCenter.providerReportedSummary.byProvider.find(
          (entry) => entry.providerId === providerId
        );
        return {
          providerId,
          providerAccounts,
          totalTokens:
            providerLogs.length > 0
              ? providerLogs.reduce(
                  (sum, entry) => sum + entry.inputTokens + entry.outputTokens,
                  0
                )
              : providerReported
                ? getProviderReportedTokenTotal(providerReported, logCenter.requestLogs)
                : 0,
          totalRequests:
            providerLogs.length > 0 ? providerLogs.length : providerReported?.totalRequests ?? 0,
          hasActivity: providerLogs.length > 0 || (providerReported?.totalRequests ?? 0) > 0,
        };
      }),
    [connectedAccounts, logCenter.providerReportedSummary.byProvider, logCenter.requestLogs, providerTabIds]
  );
  const filterProviderIds = useMemo(() => {
    const ids = new Set<ProviderId>();
    connectedAccounts.forEach((account) => ids.add(account.providerId));
    logCenter.requestLogs.forEach((entry) => ids.add(entry.providerId));
    return sortFocusedProviderIdsByUsage(
      FOCUSED_PROVIDER_IDS.filter((providerId) => ids.has(providerId)),
      (providerId) => providerUsageTotals.get(providerId) ?? 0
    );
  }, [connectedAccounts, logCenter.requestLogs, providerUsageTotals]);
  const availableRequestStatuses = useMemo(() => {
    const providerScopedLogs =
      requestProviderFilter === "all"
        ? logCenter.requestLogs
        : logCenter.requestLogs.filter((entry) => entry.providerId === requestProviderFilter);
    return [...new Set(providerScopedLogs.map((entry) => entry.status))]
      .sort((left, right) => right - left)
      .map((status) => String(status) as `${number}`);
  }, [logCenter.requestLogs, requestProviderFilter]);
  const filteredRequestLogs = useMemo(
    () => {
      if (page !== "logs") {
        return [];
      }

      return logCenter.requestLogs.filter((entry) => {
        if (requestProviderFilter !== "all" && entry.providerId !== requestProviderFilter) return false;
        if (requestStatusFilter !== "all" && String(entry.status) !== requestStatusFilter) return false;
        if (!requestQuery.trim()) return true;
        const haystack = `${entry.providerId} ${entry.model}`.toLowerCase();
        return haystack.includes(requestQuery.trim().toLowerCase());
      });
    },
    [logCenter.requestLogs, page, requestProviderFilter, requestStatusFilter, requestQuery]
  );
  const deferredRequestLogs = useDeferredValue(filteredRequestLogs);
  const deferredAppLogs = useDeferredValue(logCenter.appLogs);
  const refreshLogCenter = logCenter.refresh;

  const handleRefreshAll = useCallback(async () => {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      await refreshAll();
      await refreshLogCenter();
    } finally {
      setRefreshingAll(false);
    }
  }, [refreshAll, refreshLogCenter, refreshingAll]);

  const handleCopyLogs = async (entries: typeof logCenter.appLogs) => {
    await navigator.clipboard.writeText(
      entries
        .map((entry) => `[${formatLogTimestamp(entry.timestamp) || "n/a"}] [${entry.scope}] ${entry.message}`)
        .join("\n")
    );
    setCopiedLogs(true);
    window.setTimeout(() => setCopiedLogs(false), 1800);
  };

  const handleDownloadLogs = async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = await save({
      defaultPath: `tokenflow-app-logs-${timestamp}.log`,
      filters: [
        {
          name: "Log",
          extensions: ["log", "txt"],
        },
      ],
    });

    if (!destination) {
      return;
    }

    await invoke("export_debug_log", { destination });
  };

  useEffect(() => {
    setProviderReportedHistory(storeProviderReportedHistory(logCenter.providerReportedSummary));
  }, [logCenter.providerReportedSummary]);

  useEffect(() => {
    if (!(providerTabIds as ProviderId[]).includes(providerTab) && providerTabIds.length > 0) {
      setProviderTab(providerTabIds[0]);
    }
  }, [providerTab, providerTabIds]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listen<string>("tray-command", async (event) => {
        switch (event.payload) {
          case "refresh":
            await handleRefreshAll();
            break;
          default:
            break;
        }
      });
    };

    void setup();

    return () => {
      unlisten?.();
    };
  }, [
    handleRefreshAll,
  ]);

  if (isRestoring) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="rounded-3xl border border-border/70 bg-card/90 px-6 py-5 text-sm text-muted-foreground shadow-sm">
          {copy.common.loading}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar activePage={page} onSelectPage={setPage} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 py-4 md:px-6 md:py-6">
          {page === "dashboard" || page === "providers" || page === "logs" ? (
            <header className="flex items-center justify-between gap-4 px-1 py-1">
              <h1 className="text-3xl font-semibold tracking-tight">
                {page === "dashboard"
                  ? copy.dashboard.title
                  : page === "providers"
                    ? copy.providersPage.title
                    : copy.logs.title}
              </h1>
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefreshAll}
                disabled={refreshingAll}
                aria-label={copy.common.refreshAll}
                title={copy.common.refreshAll}
              >
                <RefreshCw className={cn("size-4", refreshingAll && "animate-spin")} />
              </Button>
            </header>
          ) : page === "settings" || page === "about" || page === "apiKeys" ? (
            <header className="flex items-center justify-between gap-4 px-1 py-1">
              <h1 className="text-3xl font-semibold tracking-tight">
                {page === "settings"
                  ? copy.settings.title
                  : page === "apiKeys"
                    ? copy.apiKeys.title
                    : copy.about.title}
              </h1>
            </header>
          ) : (
            <header className="rounded-[24px] border border-border/60 bg-card/72 px-5 py-5 backdrop-blur-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight">
                    {copy.about.title}
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    {copy.about.subtitle}
                  </p>
                </div>
              </div>
            </header>
          )}

          {page === "dashboard" ? (
            <DashboardPage
              copy={copy}
              topMetrics={topMetrics}
              monthlyBars={monthlyBars}
              monthlyRequestBars={monthlyRequestBars}
              providerSummaries={providerSummaries}
              providerColors={providerColors}
              chartLayout={DASHBOARD_CHART_LAYOUT}
              privacyMode={preferences.privacyMode}
            />
          ) : null}

          {page === "providers" ? (
            <ProvidersPage
              copy={copy}
              providerTab={providerTab}
              visibleProviderIds={providerTabIds}
              onSelectProvider={setProviderTab}
              summaries={providerPageSummaries}
              providerColors={providerColors}
              privacyMode={preferences.privacyMode}
              onAddAccount={() => setAddAccountProvider(providerTab)}
              onRemoveAccount={removeAccount}
              onRenameAccount={renameAccount}
            />
          ) : null}

          {page === "logs" ? (
            <LogsPage
              copy={copy}
              logTab={logTab}
              onLogTabChange={setLogTab}
              requestLogs={deferredRequestLogs}
              appLogs={deferredAppLogs}
              appLogPath={logCenter.appLogPath}
              requestProviderFilter={requestProviderFilter}
              onRequestProviderFilterChange={setRequestProviderFilter}
              filterProviderIds={filterProviderIds}
              requestStatusFilter={requestStatusFilter}
              onRequestStatusFilterChange={setRequestStatusFilter}
              availableRequestStatuses={availableRequestStatuses}
              onClearLogs={() => void logCenter.clear()}
              onCopyLogs={(entries) => void handleCopyLogs(entries)}
              onDownloadLogs={() => void handleDownloadLogs()}
              copiedLogs={copiedLogs}
              isLoading={logCenter.isLoading}
              error={logCenter.error}
            />
          ) : null}

          {page === "apiKeys" ? (
            <ApiKeysPage
              copy={copy}
              entries={apiKeyVault.entries}
              onCreateEntry={apiKeyVault.createEntry}
              onUpdateEntry={apiKeyVault.updateEntry}
              onRemoveEntry={apiKeyVault.removeEntry}
              onMarkCopied={apiKeyVault.markCopied}
            />
          ) : null}

          {page === "settings" ? (
            <SettingsPage
              theme={preferences.theme}
              privacyMode={preferences.privacyMode}
              minimizeToTray={preferences.minimizeToTray}
              launchOnStartup={preferences.launchOnStartup}
              autoUpdate={preferences.autoUpdate}
              providerColors={preferences.providerColors}
              onThemeChange={preferenceActions.setTheme}
              onPrivacyModeChange={preferenceActions.setPrivacyMode}
              onMinimizeToTrayChange={preferenceActions.setMinimizeToTray}
              onLaunchOnStartupChange={preferenceActions.setLaunchOnStartup}
              onAutoUpdateChange={preferenceActions.setAutoUpdate}
              onProviderColorChange={preferenceActions.setProviderColor}
              onResetProviderColors={preferenceActions.resetProviderColors}
            />
          ) : null}

          {page === "about" ? (
            <AboutPage
              version={APP_VERSION}
              autoUpdateEnabled={preferences.autoUpdate}
              updateState={appUpdater.state}
              onCheckUpdates={appUpdater.checkForUpdates}
              onInstallUpdate={appUpdater.installUpdate}
            />
          ) : null}
        </div>

        <AddAccountDialog
          open={addAccountProvider !== null}
          providerId={addAccountProvider}
          capability={addAccountProvider ? capabilities[addAccountProvider] : undefined}
          existingAccounts={focusedAccounts}
          onOpenChange={(open) => {
            if (!open) setAddAccountProvider(null);
          }}
          onAddAccount={addAccount}
        />
      </main>
    </div>
  );
}

function DashboardPage({
  copy,
  topMetrics,
  monthlyBars,
  monthlyRequestBars,
  providerSummaries,
  providerColors,
  chartLayout,
  privacyMode,
}: {
  copy: ReturnType<typeof getWorkspaceCopy>;
  topMetrics: {
    totalAccounts: number;
    totalTokens: number;
    totalRequests: number;
    connectedProviders: number;
  };
  monthlyBars: ReturnType<typeof buildMonthlyTokenBars>;
  monthlyRequestBars: ReturnType<typeof buildMonthlyRequestBars>;
  providerSummaries: Array<{
    providerId: ProviderId;
    providerAccounts: ProviderAccount[];
    totalTokens: number;
    totalRequests: number;
    hasActivity: boolean;
  }>;
  providerColors: Record<ProviderId, string>;
  chartLayout: typeof DASHBOARD_CHART_LAYOUT;
  privacyMode: boolean;
}) {
  const [activeChartProviderId, setActiveChartProviderId] = useState<ProviderId | null>(null);
  const overviewAccounts = useMemo(
    () =>
      providerSummaries.flatMap((summary) =>
        summary.providerAccounts.map((account) => ({
          account,
          providerId: summary.providerId,
        }))
      ),
    [providerSummaries]
  );
  const [overviewHideIdentity, setOverviewHideIdentity] = useState(privacyMode);
  const [overviewLayout, setOverviewLayout] = useState<"horizontal" | "vertical">("vertical");
  const chartBarsLayout: UsageBarsLayout = {
    chartHeight: chartLayout.chartHeight,
    plotHeight: chartLayout.plotHeight,
    barWidth: chartLayout.barWidth,
  };
  const chartProviderIds = useMemo(() => {
    const ids = new Set<ProviderId>(providerSummaries.map((summary) => summary.providerId));

    for (const bar of monthlyBars) {
      for (const segment of bar.segments) {
        ids.add(segment.providerId);
      }
    }

    for (const bar of monthlyRequestBars) {
      for (const segment of bar.segments) {
        ids.add(segment.providerId);
      }
    }

    return sortFocusedProviderIdsByUsage([...ids], (providerId) => {
      const summary = providerSummaries.find((item) => item.providerId === providerId);
      if (summary) {
        return summary.totalTokens;
      }

      return monthlyBars.reduce((sum, bar) => {
        const segment = bar.segments.find((item) => item.providerId === providerId);
        return sum + (segment?.value ?? 0);
      }, 0);
    });
  }, [monthlyBars, monthlyRequestBars, providerSummaries]);

  // Derive the effective active provider: clear selection when the provider
  // is no longer in the visible set (avoids a setState-in-effect pattern).
  const effectiveChartProviderId =
    activeChartProviderId && chartProviderIds.includes(activeChartProviderId)
      ? activeChartProviderId
      : null;

  const overviewVerticalRows = Math.min(6, Math.max(1, overviewAccounts.length));

  return (
    <div className="flex flex-col" style={{ gap: `${chartLayout.sectionGap}px` }}>
      <section className="grid grid-cols-4 gap-3">
        <MetricCard
          label={copy.dashboard.summary.totalAccounts}
          value={String(topMetrics.totalAccounts)}
          detail={copy.common.connectedAccounts}
          tone="blue"
          icon={<Users className="size-4" />}
        />
        <MetricCard
          label={copy.dashboard.summary.totalTokens}
          value={formatCompactNumber(topMetrics.totalTokens)}
          detail={topMetrics.totalTokens > 0 ? copy.common.month : copy.common.noActivity}
          tone="amber"
          icon={<Layers3 className="size-4" />}
        />
        <MetricCard
          label={copy.dashboard.summary.totalRequests}
          value={formatCompactNumber(topMetrics.totalRequests)}
          detail={topMetrics.totalRequests > 0 ? copy.common.month : copy.common.noActivity}
          tone="emerald"
          icon={<ArrowUpDown className="size-4" />}
        />
        <MetricCard
          label={copy.dashboard.summary.connectedProviders}
          value={String(topMetrics.connectedProviders)}
          detail={copy.common.providers}
          tone="violet"
          icon={<CheckCircle2 className="size-4" />}
        />
      </section>

      <section>
        <Card className="border-border/60 bg-card/94">
          <CardHeader className="pb-0">
            <div
              className="flex flex-wrap items-center"
              style={{ gap: `${chartLayout.legendGap}px` }}
            >
              <button
                type="button"
                onClick={() => setActiveChartProviderId(null)}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  activeChartProviderId === null
                    ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                    : "border-border/55 bg-background/70 text-muted-foreground hover:border-border/75 hover:text-foreground"
                )}
                aria-pressed={activeChartProviderId === null}
              >
                <span className="size-1.5 rounded-full bg-foreground/70" />
                <span>{copy.logs.filterAllProviders}</span>
              </button>
              {chartProviderIds.map((providerId) => (
                <button
                  key={providerId}
                  type="button"
                  onClick={() =>
                    setActiveChartProviderId((current) =>
                      current === providerId ? null : providerId
                    )
                  }
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] transition-[opacity,border-color,background-color,color,transform]",
                    effectiveChartProviderId === providerId
                      ? "border-primary/40 bg-primary/10 text-foreground shadow-sm"
                      : effectiveChartProviderId && effectiveChartProviderId !== providerId
                        ? "border-border/45 bg-background/55 text-muted-foreground opacity-55 hover:opacity-80"
                        : "border-border/55 bg-background/70 text-foreground hover:border-border/75"
                  )}
                  aria-pressed={effectiveChartProviderId === providerId}
                >
                  <div className="relative shrink-0">
                    <ProviderIcon providerId={providerId} size={14} />
                    <ProviderColorBadge
                      color={providerColors[providerId]}
                      size={6}
                      className="absolute -bottom-1 -right-1"
                    />
                  </div>
                  <span>{PROVIDERS[providerId].name}</span>
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent
            className="flex flex-col pt-0"
            style={{
              gap: `${chartLayout.chartGap}px`,
              paddingTop: `${chartLayout.legendBottomGap}px`,
            }}
          >
            <div className="flex flex-col" style={{ gap: `${chartLayout.blockGap}px` }}>
              <h2 className="text-[1.05rem] font-semibold tracking-tight">{copy.dashboard.chartTitle}</h2>
              <UsageBars
                bars={monthlyBars}
                emptyText={copy.common.noActivity}
                valueLabel={copy.common.tokens}
                activeProviderId={effectiveChartProviderId}
                layout={chartBarsLayout}
                embedded
              />
            </div>
            <div className="flex flex-col" style={{ gap: `${chartLayout.blockGap}px` }}>
              <h2 className="text-[1.05rem] font-semibold tracking-tight">{copy.dashboard.requestChartTitle}</h2>
              <UsageBars
                bars={monthlyRequestBars}
                emptyText={copy.common.noActivity}
                valueLabel={copy.common.requestCount}
                activeProviderId={effectiveChartProviderId}
                layout={chartBarsLayout}
                embedded
              />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{copy.dashboard.providerOverviewTitle}</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-xs"
              onClick={() => setOverviewHideIdentity((current) => !current)}
              aria-label={overviewHideIdentity ? "Show email" : "Hide email"}
              title={overviewHideIdentity ? "Show email" : "Hide email"}
            >
              {overviewHideIdentity ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                setOverviewLayout((current) =>
                  current === "horizontal" ? "vertical" : "horizontal"
                )
              }
              aria-label={overviewLayout === "horizontal" ? "Switch to vertical order" : "Switch to horizontal order"}
              title={overviewLayout === "horizontal" ? "Switch to vertical order" : "Switch to horizontal order"}
            >
              {overviewLayout === "horizontal" ? (
                <Rows3 className="size-3.5" />
              ) : (
                <Columns2 className="size-3.5" />
              )}
              {overviewLayout === "horizontal" ? "竖向" : "横向"}
            </Button>
          </div>
        </div>
        {overviewAccounts.length === 0 ? (
          <Card className="border-border/70 bg-card/90">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {copy.dashboard.noProviders}
            </CardContent>
          </Card>
        ) : (
          <div
            className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3"
            style={
              overviewLayout === "vertical"
                ? {
                    gridTemplateRows: `repeat(${overviewVerticalRows}, minmax(0, 1fr))`,
                    gridAutoFlow: "column",
                  }
                : undefined
            }
          >
            {overviewAccounts.map(({ account, providerId }) => {
              const windows = getAccountUsageWindows(account);
              const compactAccountLabel = overviewHideIdentity
                ? getDisplayAccountName(account, true)
                : account.email ||
                  account.username ||
                  account.alias ||
                  account.browserLabel ||
                  getDisplayAccountName(account, privacyMode);

              return (
                <div
                  key={account.accountId}
                  className="rounded-2xl border border-border/70 bg-card/92 px-3 py-2.5 text-left shadow-none"
                  title={`${PROVIDERS[providerId].name} · ${compactAccountLabel}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-border/60 bg-background/78 px-2.5 py-2">
                      <ProviderIcon providerId={providerId} size={24} />
                      <span className="rounded-full border border-border/55 bg-muted/45 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        {formatOverviewPlanBadge(account, providerId)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{compactAccountLabel}</p>
                      <div className="flex shrink-0 items-center gap-2">
                        {windows.length > 0 ? (
                          windows.slice(0, 2).map((window) => (
                            <QuotaRing
                              key={window.id}
                              window={window}
                              color={providerColors[providerId]}
                              compact
                              tiny
                              hideMeta
                              sideLabel={formatOverviewWindowLabel(window.label)}
                            />
                          ))
                        ) : (
                          <span className="text-[11px] text-muted-foreground">{copy.common.noData}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
function ProvidersPage({
  copy,
  providerTab,
  visibleProviderIds,
  onSelectProvider,
  summaries,
  providerColors,
  privacyMode,
  onAddAccount,
  onRemoveAccount,
  onRenameAccount,
}: {
  copy: ReturnType<typeof getWorkspaceCopy>;
  providerTab: ProviderId;
  visibleProviderIds: ProviderId[];
  onSelectProvider: (providerId: ProviderId) => void;
  summaries: Array<{ providerId: ProviderId; providerAccounts: ProviderAccount[]; totalTokens: number; totalRequests: number; hasActivity: boolean }>;
  providerColors: Record<ProviderId, string>;
  privacyMode: boolean;
  onAddAccount: () => void;
  onRemoveAccount: (accountId: string) => Promise<void>;
  onRenameAccount: (accountId: string, label: string) => Promise<void>;
}) {
  const activeSummary = summaries.find((summary) => summary.providerId === providerTab) ?? summaries[0];
  const attentionCount = activeSummary
    ? getAttentionAccounts(activeSummary.providerAccounts).length
    : 0;
  const [hideAccountIdentity, setHideAccountIdentity] = useState(privacyMode);
  const accountCardLayout = DEFAULT_ACCOUNT_CARD_LAYOUT;
  const [editingAccount, setEditingAccount] = useState<ProviderAccount | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<ProviderAccount | null>(null);
  const [draftAlias, setDraftAlias] = useState("");
  const [submittingAccountAction, setSubmittingAccountAction] = useState(false);
  const orderedProviderAccounts = useMemo(
    () => sortAccountsByLoginOrder(activeSummary?.providerAccounts ?? []),
    [activeSummary?.providerAccounts]
  );

  useEffect(() => {
    if (editingAccount) {
      setDraftAlias(editingAccount.alias ?? "");
    }
  }, [editingAccount]);

  const handleSaveAlias = async () => {
    if (!editingAccount) return;
    setSubmittingAccountAction(true);
    try {
      await onRenameAccount(
        editingAccount.accountId,
        draftAlias.trim() ||
          editingAccount.email ||
          editingAccount.username ||
          editingAccount.alias ||
          "Account"
      );
      setEditingAccount(null);
    } finally {
      setSubmittingAccountAction(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletingAccount) return;
    setSubmittingAccountAction(true);
    try {
      await onRemoveAccount(deletingAccount.accountId);
      setDeletingAccount(null);
    } finally {
      setSubmittingAccountAction(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-6 gap-2">
        {visibleProviderIds.map((providerId) => {
          return (
            <button
              key={providerId}
              onClick={() => onSelectProvider(providerId)}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-center transition-[background-color,border-color,color,box-shadow] duration-150",
                providerTab === providerId
                  ? "border border-sky-300/70 bg-sky-500/10 text-sky-700 shadow-[0_6px_18px_rgba(59,130,246,0.08)] dark:border-sky-400/25 dark:bg-sky-400/12 dark:text-sky-200 dark:shadow-[0_8px_22px_rgba(56,189,248,0.08)]"
                  : "border border-border/70 bg-card/88 text-foreground hover:border-border hover:bg-muted/55 dark:bg-card/78 dark:hover:bg-muted/35"
              )}
            >
              <ProviderIcon providerId={providerId} size={16} />
              <p className="truncate text-sm font-semibold">{PROVIDERS[providerId].name}</p>
            </button>
          );
        })}
      </div>

      {activeSummary ? (
        <>
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border/70 bg-card/90 px-4 py-3">
            <div className="flex items-center gap-2 pr-2">
              <ProviderIcon providerId={activeSummary.providerId} size={18} />
              <p className="text-base font-semibold">{PROVIDERS[activeSummary.providerId].name}</p>
            </div>
            <div className="h-5 w-px bg-border/70" />
            <div className="flex flex-1 flex-wrap items-center gap-5">
              <CompactProviderStat
                label={copy.providersPage.stats.accounts}
                value={String(activeSummary.providerAccounts.length)}
                accentColor={providerColors[activeSummary.providerId]}
              />
              <CompactProviderStat
                label={copy.providersPage.stats.tokens}
                value={formatCompactNumber(activeSummary.totalTokens)}
                accentColor={providerColors[activeSummary.providerId]}
              />
              <CompactProviderStat
                label={copy.providersPage.stats.requests}
                value={formatCompactNumber(activeSummary.totalRequests)}
                accentColor={providerColors[activeSummary.providerId]}
              />
              <CompactProviderStat
                label={copy.providersPage.stats.attention}
                value={formatCompactNumber(attentionCount)}
                accentColor={providerColors[activeSummary.providerId]}
              />
            </div>
            <Button size="sm" onClick={onAddAccount} className="ml-auto">
              <Plus className="size-4" />
              {copy.common.addAccount}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight">{copy.providersPage.accountListTitle}</h2>
            <Button
              variant="outline"
              size="icon-xs"
              onClick={() => setHideAccountIdentity((current) => !current)}
              aria-label={hideAccountIdentity ? "Show email" : "Hide email"}
              title={hideAccountIdentity ? "Show email" : "Hide email"}
            >
              {hideAccountIdentity ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {orderedProviderAccounts.length > 0 ? (
              orderedProviderAccounts.map((account) => (
                <ProviderAccountPanel
                  key={account.accountId}
                  account={account}
                  color={providerColors[activeSummary.providerId]}
                  privacyMode={privacyMode || hideAccountIdentity}
                  copy={copy}
                  layout={accountCardLayout}
                  onEditAlias={() => setEditingAccount(account)}
                  onDelete={() => setDeletingAccount(account)}
                />
              ))
            ) : (
              <Card className="border-border/70 bg-card/90 xl:col-span-2">
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  {copy.dashboard.providerRequestOnlyState(PROVIDERS[activeSummary.providerId].name)}
                </CardContent>
              </Card>
            )}
          </div>
          <Dialog open={editingAccount !== null} onOpenChange={(open) => !open && setEditingAccount(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{copy.providersPage.editAliasTitle ?? "Edit note"}</DialogTitle>
                <DialogDescription>
                  {copy.providersPage.editAliasDescription?.(
                    editingAccount ? getDisplayAccountName(editingAccount, false) : ""
                  ) ?? "Update the label shown for this account."}
                </DialogDescription>
              </DialogHeader>
              <input
                value={draftAlias}
                onChange={(event) => setDraftAlias(event.target.value)}
                placeholder={copy.providersPage.editAliasPlaceholder ?? "Account note"}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingAccount(null)} disabled={submittingAccountAction}>
                  {copy.common.close}
                </Button>
                <Button onClick={() => void handleSaveAlias()} disabled={submittingAccountAction}>
                  {copy.providersPage.saveAlias ?? "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={deletingAccount !== null} onOpenChange={(open) => !open && setDeletingAccount(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{copy.providersPage.deleteAccountTitle ?? "Delete login"}</DialogTitle>
                <DialogDescription>
                  {copy.providersPage.deleteAccountDescription?.(
                    deletingAccount ? getDisplayAccountName(deletingAccount, false) : ""
                  ) ?? "This removes the saved login from TokenFlow."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeletingAccount(null)} disabled={submittingAccountAction}>
                  {copy.common.close}
                </Button>
                <Button variant="destructive" onClick={() => void handleDeleteAccount()} disabled={submittingAccountAction}>
                  {copy.providersPage.confirmDeleteAccount ?? "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <Card className="border-border/70 bg-card/90">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {copy.providersPage.pageEmpty}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LogsPage({
  copy,
  logTab,
  onLogTabChange,
  requestLogs,
  appLogs,
  appLogPath,
  requestProviderFilter,
  onRequestProviderFilterChange,
  filterProviderIds,
  requestStatusFilter,
  onRequestStatusFilterChange,
  availableRequestStatuses,
  onClearLogs,
  onCopyLogs,
  onDownloadLogs,
  copiedLogs,
  isLoading,
  error,
}: {
  copy: ReturnType<typeof getWorkspaceCopy>;
  logTab: "requests" | "app";
  onLogTabChange: (tab: "requests" | "app") => void;
  requestLogs: ReturnType<typeof useLogCenter>["requestLogs"];
  appLogs: ReturnType<typeof useLogCenter>["appLogs"];
  appLogPath: string;
  requestProviderFilter: ProviderId | "all";
  onRequestProviderFilterChange: (providerId: ProviderId | "all") => void;
  filterProviderIds: ProviderId[];
  requestStatusFilter: RequestStatusFilter;
  onRequestStatusFilterChange: (status: RequestStatusFilter) => void;
  availableRequestStatuses: Array<`${number}`>;
  onClearLogs: () => void;
  onCopyLogs: (entries: ReturnType<typeof useLogCenter>["appLogs"]) => void;
  onDownloadLogs: () => void;
  copiedLogs: boolean;
  isLoading: boolean;
  error: string;
}) {
  const PAGE_SIZE = 20;
  const [requestPage, setRequestPage] = useState(1);
  const [appPage, setAppPage] = useState(1);
  const [requestPageInput, setRequestPageInput] = useState("1");
  const [appPageInput, setAppPageInput] = useState("1");
  const [confirmClearAppLogsOpen, setConfirmClearAppLogsOpen] = useState(false);

  useEffect(() => {
    setRequestPage(1);
  }, [requestLogs, requestProviderFilter, requestStatusFilter]);

  useEffect(() => {
    setAppPage(1);
  }, [appLogs]);

  const totalRequestPages = Math.max(1, Math.ceil(requestLogs.length / PAGE_SIZE));
  const totalAppPages = Math.max(1, Math.ceil(appLogs.length / PAGE_SIZE));
  const displayedRequestLogs = useMemo(
    () => requestLogs.slice((requestPage - 1) * PAGE_SIZE, requestPage * PAGE_SIZE),
    [requestLogs, requestPage]
  );
  const displayedAppLogs = useMemo(
    () => appLogs.slice((appPage - 1) * PAGE_SIZE, appPage * PAGE_SIZE),
    [appLogs, appPage]
  );

  useEffect(() => {
    setRequestPageInput(String(requestPage));
  }, [requestPage]);

  useEffect(() => {
    setAppPageInput(String(appPage));
  }, [appPage]);

  const jumpToRequestPage = () => {
    const page = Number.parseInt(requestPageInput, 10);
    if (Number.isNaN(page)) {
      setRequestPageInput(String(requestPage));
      return;
    }
    setRequestPage(Math.min(totalRequestPages, Math.max(1, page)));
  };

  const jumpToAppPage = () => {
    const page = Number.parseInt(appPageInput, 10);
    if (Number.isNaN(page)) {
      setAppPageInput(String(appPage));
      return;
    }
    setAppPage(Math.min(totalAppPages, Math.max(1, page)));
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Button variant={logTab === "requests" ? "default" : "outline"} onClick={() => onLogTabChange("requests")}>
          {copy.common.requests}
        </Button>
        <Button variant={logTab === "app" ? "default" : "outline"} onClick={() => onLogTabChange("app")}>
          {copy.common.appLogs}
        </Button>
      </div>

      {logTab === "requests" ? (
        <div className="space-y-4">
          <Card className="border-border/70 bg-card/90">
            <CardHeader>
              <div className="space-y-1">
                <CardTitle>{copy.logs.requestTableTitle}</CardTitle>
                <CardDescription>{copy.logs.requestTableSubtitle}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2">
                  <select
                    value={requestProviderFilter}
                    onChange={(event) => onRequestProviderFilterChange(event.target.value as ProviderId | "all")}
                    className="h-10 rounded-2xl border border-border/70 bg-background px-3 text-sm"
                  >
                    <option value="all">{copy.logs.filterAllProviders}</option>
                    {filterProviderIds.map((providerId) => (
                      <option key={providerId} value={providerId}>{PROVIDERS[providerId].name}</option>
                    ))}
                  </select>
                  <select
                    value={requestStatusFilter}
                    onChange={(event) => onRequestStatusFilterChange(event.target.value as RequestStatusFilter)}
                    className="h-10 rounded-2xl border border-border/70 bg-background px-3 text-sm"
                  >
                    <option value="all">{copy.logs.filterAllStatus}</option>
                    {availableRequestStatuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
              </div>
            </CardContent>
            <CardContent>
              {requestLogs.length === 0 ? (
                <div className="flex h-[320px] items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/60 text-sm text-muted-foreground">
                  {copy.logs.requestEmpty}
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border/70">
                  <div className="grid grid-cols-[160px_120px_minmax(0,1fr)_150px_100px_170px] gap-3 border-b border-border/70 bg-muted/40 px-4 py-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    <span>{copy.logs.time}</span>
                    <span>{copy.logs.filterProvider}</span>
                    <span>{copy.logs.model}</span>
                    <span>{copy.logs.source}</span>
                    <span>{copy.logs.status}</span>
                    <span>{copy.logs.inputOutput}</span>
                  </div>
                  <div className="divide-y divide-border/70">
                    {displayedRequestLogs.map((entry) => (
                      <div key={entry.id} className="grid grid-cols-[160px_120px_minmax(0,1fr)_150px_100px_170px] gap-3 px-4 py-3 text-sm">
                        <span className="text-muted-foreground">{formatLogTimestamp(entry.timestamp)}</span>
                        <span>{PROVIDERS[entry.providerId].name}</span>
                        <span className="truncate font-medium">{entry.model}</span>
                        <span>
                          <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", getTrackingSourceBadgeClassName(entry.sourceType))}>
                            {entry.sourceLabel ?? formatTrackingSource(copy, entry.sourceType)}
                          </span>
                        </span>
                        <span>
                          <span className={cn("inline-flex min-w-[56px] justify-center rounded-full px-2.5 py-1 text-xs font-medium", getStatusBadgeClassName(entry.status))}>
                            {entry.status}
                          </span>
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatCompactNumber(entry.inputTokens)}
                          {" -> "}
                          {formatCompactNumber(entry.outputTokens)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {requestLogs.length > PAGE_SIZE ? (
                    <div className="flex items-center justify-between border-t border-border/70 bg-background/70 px-4 py-3">
                      <p className="text-xs text-muted-foreground">
                        {copy.logs.showingRows(displayedRequestLogs.length, requestLogs.length)}
                        {" | "}
                        {copy.logs.pageStatus(requestPage, totalRequestPages)}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={requestPage <= 1}
                          onClick={() => setRequestPage((page) => Math.max(1, page - 1))}
                        >
                          {copy.logs.previousPage}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={requestPage >= totalRequestPages}
                          onClick={() => setRequestPage((page) => Math.min(totalRequestPages, page + 1))}
                        >
                          {copy.logs.nextPage}
                        </Button>
                        <input
                          value={requestPageInput}
                          onChange={(event) => setRequestPageInput(event.target.value.replace(/[^\d]/g, ""))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              jumpToRequestPage();
                            }
                          }}
                          className="h-9 w-14 rounded-xl border border-border/70 bg-background px-2 text-center text-sm outline-none"
                          inputMode="numeric"
                        />
                        <Button variant="outline" size="sm" onClick={jumpToRequestPage}>
                          {copy.logs.goToPage}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
          <Card className="border-border/70 bg-card/90">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>{copy.logs.appLogTitle}</CardTitle>
                  <CardDescription>{copy.logs.appLogSubtitle}</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onCopyLogs(displayedAppLogs)}>
                    <Copy className="size-4" />
                    {copiedLogs ? copy.logs.copied : copy.logs.copyCurrentPage}
                  </Button>
                  <Button variant="outline" onClick={onDownloadLogs}>
                    <ArrowUpDown className="size-4" />
                    {copy.logs.downloadLogs}
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmClearAppLogsOpen(true)}>
                    <FileClock className="size-4" />
                    {copy.logs.clear}
                  </Button>
                  <Dialog open={confirmClearAppLogsOpen} onOpenChange={setConfirmClearAppLogsOpen}>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>{copy.logs.clearLogsTitle}</DialogTitle>
                        <DialogDescription>{copy.logs.clearLogsDescription}</DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmClearAppLogsOpen(false)}>
                          {copy.common.close}
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => {
                            onClearLogs();
                            setConfirmClearAppLogsOpen(false);
                          }}
                        >
                          {copy.logs.clear}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {appLogPath ? (
                <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{copy.logs.logPath}</p>
                  <p className="mt-1 break-all font-mono text-[11px] leading-5">{appLogPath}</p>
                </div>
              ) : null}
              <div className="overflow-hidden rounded-2xl border border-border/70">
                <div className="grid grid-cols-[190px_160px_1fr] gap-3 border-b border-border/70 bg-muted/35 px-4 py-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  <span>{copy.logs.time}</span>
                  <span>{copy.logs.scope}</span>
                  <span>{copy.logs.message}</span>
                </div>
                <div className="max-h-[520px] overflow-y-auto divide-y divide-border/60 bg-background/40">
                  {error ? (
                    <div className="px-4 py-6 text-sm text-destructive">{error}</div>
                  ) : isLoading ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">{copy.common.loading}</div>
                  ) : appLogs.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">{copy.logs.appLogEmpty}</div>
                  ) : (
                    displayedAppLogs.map((entry) => (
                      <div key={entry.id} className="grid grid-cols-[190px_160px_1fr] gap-3 px-4 py-3 text-sm">
                        <span className="font-mono text-[12px] text-muted-foreground">
                          {formatLogTimestamp(entry.timestamp) || "n/a"}
                        </span>
                        <span>
                          <span className="inline-flex rounded-full border border-border/60 bg-muted/45 px-2.5 py-1 text-[11px] font-medium text-foreground">
                            {entry.scope}
                          </span>
                        </span>
                        <span className="break-words leading-6 text-muted-foreground">{entry.message}</span>
                      </div>
                    ))
                  )}
                </div>
              {appLogs.length > PAGE_SIZE ? (
                <div className="flex items-center justify-between border-t border-border/70 bg-background/70 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    {copy.logs.showingRows(displayedAppLogs.length, appLogs.length)}
                    {" | "}
                    {copy.logs.pageStatus(appPage, totalAppPages)}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={appPage <= 1}
                      onClick={() => setAppPage((page) => Math.max(1, page - 1))}
                    >
                      {copy.logs.previousPage}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={appPage >= totalAppPages}
                      onClick={() => setAppPage((page) => Math.min(totalAppPages, page + 1))}
                    >
                      {copy.logs.nextPage}
                    </Button>
                    <input
                      value={appPageInput}
                      onChange={(event) => setAppPageInput(event.target.value.replace(/[^\d]/g, ""))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          jumpToAppPage();
                        }
                      }}
                      className="h-9 w-14 rounded-xl border border-border/70 bg-background px-2 text-center text-sm outline-none"
                      inputMode="numeric"
                    />
                    <Button variant="outline" size="sm" onClick={jumpToAppPage}>
                      {copy.logs.goToPage}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ProviderAccountPanel({
  account,
  color,
  privacyMode,
  copy,
  layout,
  onEditAlias,
  onDelete,
}: {
  account: ProviderAccount;
  color: string;
  privacyMode: boolean;
  copy: ReturnType<typeof getWorkspaceCopy>;
  layout: AccountCardLayout;
  onEditAlias: () => void;
  onDelete: () => void;
}) {
  const windows = getAccountUsageWindows(account);
  const headlineWindow = getHeadlineUsageWindow(account);
  const displayWindows = sortOverviewWindows(windows).slice(0, 2);
  const risk = getAccountRiskLevel(account);
  const displayName = getDisplayAccountName(account, privacyMode);
  const planBadge = formatOverviewPlanBadge(account, account.providerId);
  const resetLabel = headlineWindow?.quota.resetsAt
    ? formatResetTime(headlineWindow.quota.resetsAt)
    : null;

  return (
    <Card className="border-border/70 bg-card/90">
      <CardContent className="px-4" style={{ paddingTop: `${layout.cardPaddingY}px`, paddingBottom: `${layout.cardPaddingY}px` }}>
        <div className="flex items-center justify-between" style={{ gap: `${layout.cardGap}px` }}>
          <div className="min-w-0 flex flex-1 items-center" style={{ gap: `${layout.cardGap + 2}px` }}>
            <ProviderIcon providerId={account.providerId} size={layout.logoSize} />
            <div className="min-w-0">
              <p className="truncate font-semibold" style={{ fontSize: `${layout.titleSize}px` }}>{displayName}</p>
              <div
                className="mt-0.5 flex flex-wrap items-center text-muted-foreground"
                style={{ gap: `${Math.max(6, layout.cardGap - 1)}px`, fontSize: `${layout.metaSize}px` }}
              >
                <span className="truncate">{getDisplayAccountMeta(account, privacyMode)}</span>
                <span
                  className="rounded-full border border-border/55 bg-muted/45 px-2 py-0.5 font-medium uppercase tracking-[0.08em] text-muted-foreground"
                  style={{ fontSize: `${Math.max(10, layout.metaSize - 1)}px` }}
                >
                  {planBadge}
                </span>
                {resetLabel ? <span>{resetLabel}</span> : null}
                <span>{formatLastFetchedAt(account.lastFetchedAt)}</span>
              </div>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-[auto_auto_minmax(72px,auto)_auto_auto] items-center" style={{ columnGap: `${layout.ringGap}px` }}>
            {displayWindows.length > 0 ? (
              <>
                {displayWindows.map((window) => (
                  <QuotaRing
                    key={window.id}
                    window={window}
                    color={color}
                    compact
                    tiny
                    hideMeta
                    sideLabel={formatOverviewWindowLabel(window.label)}
                    sizeOverride={layout.ringSize}
                    sideLabelSize={layout.sideLabelSize}
                  />
                ))}
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">{copy.dashboard.riskNoWindow}</span>
            )}
            <span
              className={cn(
                "inline-flex min-w-[72px] justify-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                getRiskBadgeClassName(risk)
              )}
            >
              {formatRiskLabel(copy, risk)}
            </span>
            <div className="ml-1 flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-xs"
                onClick={onEditAlias}
                aria-label={copy.providersPage.editAliasTitle ?? "Edit note"}
                title={copy.providersPage.editAliasTitle ?? "Edit note"}
              >
                <PencilLine className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon-xs"
                onClick={onDelete}
                aria-label={copy.providersPage.deleteAccountTitle ?? "Delete login"}
                title={copy.providersPage.deleteAccountTitle ?? "Delete login"}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "blue",
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "blue" | "amber" | "emerald" | "violet";
  icon?: ReactNode;
}) {
  const toneClassName =
    tone === "blue"
      ? "text-blue-500"
      : tone === "amber"
        ? "text-amber-400"
        : tone === "emerald"
        ? "text-emerald-500"
        : tone === "violet"
          ? "text-fuchsia-500"
          : "text-blue-500";

  return (
    <Card className="border-border/45 bg-card/92 shadow-none dark:border-border/70 dark:bg-card/78">
      <CardContent className="flex min-h-[92px] flex-col justify-between pt-4">
        <div className={cn("flex items-center gap-1.5 text-[11px] font-semibold", toneClassName)}>
          {icon ? <span>{icon}</span> : null}
          <p>{label}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[42px] font-semibold leading-none tracking-[-0.05em] text-foreground">
            {value}
          </p>
          <p className="text-[11px] text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function formatLogTimestamp(timestamp?: string) {
  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function CompactProviderStat({
  label,
  value,
  accentColor,
}: {
  label: string;
  value: string;
  accentColor: string;
}) {
  return (
    <div className="group relative min-w-[112px] whitespace-nowrap py-1.5">
      <div className="mb-1 flex items-center">
        <p
          className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em]"
          style={{
            backgroundColor: `color-mix(in srgb, ${accentColor} 14%, var(--muted))`,
            color: `color-mix(in srgb, ${accentColor} 72%, var(--foreground))`,
          }}
        >
          {label}
        </p>
      </div>
      <p className="pl-2 text-[1.35rem] font-semibold leading-none tracking-[-0.03em] text-foreground transition-transform duration-150 group-hover:translate-y-[-1px]">
        {value}
      </p>
    </div>
  );
}

function formatOverviewWindowLabel(label: string) {
  const normalized = label.toLowerCase();

  const hourMatch = normalized.match(/(\d+)-hour/);
  if (hourMatch) {
    return `${hourMatch[1]}h`;
  }

  const dayMatch = normalized.match(/(\d+)-day/);
  if (dayMatch) {
    return `${dayMatch[1]}d`;
  }

  const weekMatch = normalized.match(/(\d+)-week/);
  if (weekMatch) {
    const weeks = Number(weekMatch[1]);
    return `${weeks * 7}d`;
  }

  if (normalized.includes("week")) {
    return "week";
  }
  if (normalized.includes("month")) {
    return "month";
  }
  if (normalized.includes("session")) {
    return "session";
  }
  if (normalized.includes("premium")) {
    return "premium";
  }
  if (normalized.includes("chat")) {
    return "chat";
  }
  if (normalized.includes("plan")) {
    return "plan";
  }
  if (normalized.includes("workspace")) {
    return "workspace";
  }
  if (normalized.includes("model")) {
    return "model";
  }
  if (normalized.includes("spend")) {
    return "spend";
  }
  if (normalized.includes("credit")) {
    return "credit";
  }

  return label.length > 10 ? `${label.slice(0, 10)}...` : label;
}

function sortOverviewWindows(windows: ReturnType<typeof getAccountUsageWindows>) {
  return [...windows].sort((left, right) => {
    const leftPriority = getOverviewWindowPriority(left.label);
    const rightPriority = getOverviewWindowPriority(right.label);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.label.localeCompare(right.label);
  });
}

function getOverviewWindowPriority(label: string) {
  const normalized = label.toLowerCase();

  const minuteMatch = normalized.match(/(\d+)-minute/);
  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }

  const hourMatch = normalized.match(/(\d+)-hour/);
  if (hourMatch) {
    return Number(hourMatch[1]) * 60;
  }

  const sessionMatch = normalized.match(/session/);
  if (sessionMatch) {
    return 5 * 60;
  }

  const dayMatch = normalized.match(/(\d+)-day/);
  if (dayMatch) {
    return Number(dayMatch[1]) * 60 * 24;
  }

  const weekMatch = normalized.match(/(\d+)-week/);
  if (weekMatch) {
    return Number(weekMatch[1]) * 60 * 24 * 7;
  }

  if (normalized.includes("week")) {
    return 60 * 24 * 7;
  }
  if (normalized.includes("month")) {
    return 60 * 24 * 30;
  }
  if (normalized.includes("chat")) {
    return 60 * 24 * 7 + 1;
  }
  if (normalized.includes("premium")) {
    return 60 * 24 * 30 + 1;
  }
  if (normalized.includes("plan")) {
    return 60 * 24 * 30 + 2;
  }

  return Number.POSITIVE_INFINITY;
}

function formatOverviewPlanBadge(account: ProviderAccount, providerId: ProviderId) {
  const rawPlan = account.subscription?.plan || account.openaiPlan || PROVIDERS[providerId].name;
  if (!rawPlan) {
    return "";
  }

  const normalized = rawPlan.toString().trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (normalized.includes("enterprise")) return "Enterprise";
  if (normalized.includes("business")) return "Business";
  if (normalized.includes("team")) return "Team";
  if (normalized.includes("ultra")) return "Ultra";
  if (normalized.includes("pro")) return "Pro";
  if (normalized.includes("plus")) return "Plus";
  if (normalized.includes("individual")) return "Individual";
  if (normalized.includes("premium")) return "Premium";
  if (normalized.includes("free")) return "Free";
  if (normalized.includes("edu")) return "Edu";
  if (normalized.includes("go")) return "Go";

  return rawPlan.toString().slice(0, 12);
}

function getRiskBadgeClassName(risk: RiskLevel) {
  switch (risk) {
    case "critical":
      return "bg-red-500/12 text-red-700 dark:bg-red-500/16 dark:text-red-300";
    case "error":
      return "bg-rose-500/12 text-rose-700 dark:bg-rose-500/16 dark:text-rose-300";
    case "warning":
      return "bg-amber-500/12 text-amber-700 dark:bg-amber-500/16 dark:text-amber-300";
    case "offline":
      return "bg-slate-500/12 text-slate-700 dark:bg-slate-500/18 dark:text-slate-300";
    default:
      return "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/16 dark:text-emerald-300";
  }
}

function formatRiskLabel(copy: ReturnType<typeof getWorkspaceCopy>, risk: RiskLevel) {
  switch (risk) {
    case "critical":
      return copy.dashboard.riskCritical;
    case "error":
      return copy.dashboard.riskError;
    case "warning":
      return copy.dashboard.riskWarning;
    case "offline":
      return copy.dashboard.riskOffline;
    default:
      return copy.dashboard.riskHealthy;
  }
}

function getTrackingSourceBadgeClassName(sourceType: RequestDataSource) {
  switch (sourceType) {
    case "gateway_observed":
      return "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/16 dark:text-emerald-300";
    case "provider_reported_summary":
      return "bg-sky-500/12 text-sky-700 dark:bg-sky-500/16 dark:text-sky-300";
    case "provider_reported":
      return "bg-indigo-500/12 text-indigo-700 dark:bg-indigo-500/16 dark:text-indigo-300";
    default:
      return "bg-slate-500/12 text-slate-700 dark:bg-slate-500/18 dark:text-slate-300";
  }
}

function getStatusBadgeClassName(status: number) {
  if (status >= 200 && status < 300) {
    return "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/16 dark:text-emerald-300";
  }
  if (status >= 400 && status < 500) {
    return "bg-amber-500/12 text-amber-700 dark:bg-amber-500/16 dark:text-amber-300";
  }
  if (status >= 500) {
    return "bg-rose-500/12 text-rose-700 dark:bg-rose-500/16 dark:text-rose-300";
  }
  return "bg-slate-500/12 text-slate-700 dark:bg-slate-500/18 dark:text-slate-300";
}

function formatTrackingSource(
  copy: ReturnType<typeof getWorkspaceCopy>,
  sourceType: RequestDataSource
) {
  if (sourceType === "gateway_observed") {
    return copy.logs.trackingSourceGateway;
  }

  if (sourceType === "provider_reported_summary") {
    return copy.logs.trackingOfficialSummary;
  }

  if (sourceType === "provider_reported") {
    return copy.logs.trackingSourceProvider;
  }

  return copy.logs.trackingSourceLocal;
}

