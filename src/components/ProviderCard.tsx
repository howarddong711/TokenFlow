import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getAccountUsageWindows,
  formatLastFetchedAt,
  formatResetTime,
  getAccountRiskLevel,
  getConnectionLabel,
  getHeadlineUsageWindow,
  getQuotaRemainingPercent,
} from "@/lib/monitoring";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { getProductCopy } from "@/i18n/productCopy";
import { openInBrowser } from "@/services/browser";
import type { ProviderAccount, ProviderUsageWindow } from "@/types";
import { PROVIDERS } from "@/types";
import {
  AlertTriangle,
  Check,
  Clock3,
  ExternalLink,
  LinkIcon,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Star,
  Trash2,
  Wrench,
} from "lucide-react";
import type { ProviderId, PulseStream } from "@/types";
import { PulseSparkline } from "@/components/PulseSparkline";

interface ProviderCardProps {
  account: ProviderAccount;
  expanded?: boolean;
  onConnect?: (id: ProviderId) => void;
  onRefresh?: (accountId: string) => void;
  onRepair?: (accountId: string) => void;
  onRemove?: (accountId: string) => void;
  onRename?: (accountId: string, alias: string) => void;
  onSetDefault?: (accountId: string) => void;
  pulseStream?: PulseStream | null;
}

export function ProviderCard({
  account,
  expanded,
  onConnect,
  onRefresh,
  onRepair,
  onRemove,
  onRename,
  onSetDefault,
  pulseStream,
}: ProviderCardProps) {
  const { t, lang } = useI18n();
  const productCopy = getProductCopy(lang);
  const copy = productCopy.providerCard;
  const riskCopy = productCopy.dashboard.risk;
  const trendCopy = productCopy.flowPulse.trends;
  const meta = PROVIDERS[account.providerId];
  const isConnected = account.authStatus === "connected";
  const riskLevel = getAccountRiskLevel(account);
  const headlineWindow = useMemo(() => getHeadlineUsageWindow(account), [account]);
  const usageWindows = useMemo(() => getAccountUsageWindows(account), [account]);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftAlias, setDraftAlias] = useState(account.alias ?? "");
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  const accountLabel = account.alias ?? account.email ?? account.username ?? meta.name;
  const connectionLabel = getConnectionLabel(account);
  const headlineRemaining = headlineWindow ? getQuotaRemainingPercent(headlineWindow.quota) : null;

  const statusConfig = {
    connected: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
    connecting: "bg-sky-500/10 text-sky-700 border-sky-200",
    error: "bg-rose-500/10 text-rose-700 border-rose-200",
    disconnected: "bg-slate-500/10 text-slate-700 border-slate-200",
  }[account.authStatus];

  const riskConfig = {
    healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    critical: "border-rose-200 bg-rose-50 text-rose-700",
    error: "border-rose-200 bg-rose-50 text-rose-700",
    offline: "border-slate-200 bg-slate-50 text-slate-600",
  }[riskLevel];

  const handleOpenPortal = () => {
    if (!meta.portalUrl) return;
    void openInBrowser(meta.portalUrl);
  };

  const handleSaveAlias = () => {
    onRename?.(account.accountId, draftAlias.trim());
    setIsRenaming(false);
  };

  const handleStartRenaming = () => {
    setDraftAlias(account.alias ?? "");
    setIsRenaming(true);
  };

  return (
    <Card
      className={cn(
        "overflow-hidden border-border/70 bg-card/95 shadow-sm",
        expanded && "col-span-full"
      )}
    >
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-sm"
              style={{ backgroundColor: meta.color }}
            >
              {meta.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="truncate text-lg">{accountLabel}</CardTitle>
                {account.isDefault ? (
                  <Badge variant="secondary" className="gap-1">
                    <Star className="size-3 fill-current" />
                    {t("provider.default")}
                  </Badge>
                ) : null}
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    riskConfig
                  )}
                >
                  {riskLevel === "critical" || riskLevel === "error" ? (
                    <ShieldAlert className="mr-1 size-3.5" />
                  ) : riskLevel === "warning" ? (
                    <AlertTriangle className="mr-1 size-3.5" />
                  ) : (
                    <Check className="mr-1 size-3.5" />
                  )}
                  {riskCopy[riskLevel === "error" ? "error" : riskLevel]}
                </span>
              </div>
              <CardDescription className="line-clamp-2 text-sm leading-6">
                {isConnected
                  ? `${meta.name}${
                      account.email
                        ? ` / ${account.email}`
                        : account.username
                          ? ` / ${account.username}`
                          : ""
                    }`
                  : meta.description}
              </CardDescription>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{connectionLabel}</Badge>
                {account.subscription?.plan ? (
                  <Badge variant="outline">{account.subscription.plan}</Badge>
                ) : null}
                <Badge variant="outline" className={statusConfig}>
                  {account.authStatus === "connected"
                    ? t("provider.connected")
                    : account.authStatus === "connecting"
                      ? t("provider.connecting")
                      : account.authStatus === "error"
                        ? t("provider.error")
                        : t("provider.notConnected")}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isConnected ? (
              <>
                {meta.portalUrl ? (
                  <Button variant="ghost" size="sm" onClick={handleOpenPortal}>
                    <ExternalLink className="size-3.5" />
                    {t("provider.portal")}
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => onConnect?.(account.providerId)}>
                  <LinkIcon className="size-3.5" />
                  {copy.addAccount}
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => onRefresh?.(account.accountId)}>
                  <RefreshCw className="size-3.5" />
                  {t("provider.refresh")}
                </Button>
                {account.providerId === "cursor" ? (
                  <Button variant="ghost" size="sm" onClick={() => onRepair?.(account.accountId)}>
                    <Wrench className="size-3.5" />
                    {copy.repair}
                  </Button>
                ) : null}
                {meta.portalUrl ? (
                  <Button variant="ghost" size="sm" onClick={handleOpenPortal}>
                    <ExternalLink className="size-3.5" />
                    {t("provider.portal")}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isConnected ? (
          <>
            <div className="grid gap-3 md:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {copy.monitoringFocus}
                </p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold">
                      {headlineWindow?.label ?? copy.noQuotaWindows}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {headlineWindow?.quota.valueLabel ??
                        account.sessionHealthReason ??
                        copy.waitingNextSync}
                    </p>
                  </div>
                  {headlineRemaining != null ? (
                    <div className="rounded-2xl bg-foreground px-3 py-2 text-right text-background">
                      <p className="text-[11px] uppercase tracking-[0.18em] opacity-70">
                        {copy.remaining}
                      </p>
                      <p className="text-2xl font-semibold leading-none">
                        {Math.round(headlineRemaining)}%
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatLastFetchedAt(account.lastFetchedAt)}</span>
                  {account.browserLabel ? (
                    <span>{copy.connectionOrigin}: {account.browserLabel}</span>
                  ) : null}
                  {headlineWindow?.quota.resetsAt ? (
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3.5" />
                      {formatResetTime(headlineWindow.quota.resetsAt) ?? copy.resetUnavailable}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {copy.accountControls}
                  </p>
                  {!account.isDefault ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => onSetDefault?.(account.accountId)}
                    >
                      <Star className="size-3" />
                      {t("provider.setDefault")}
                    </Button>
                  ) : null}
                </div>
                <div className="mt-3 rounded-2xl border border-border/60 bg-card/70 p-3">
                  {isRenaming ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={draftAlias}
                        onChange={(event) => setDraftAlias(event.target.value)}
                        placeholder={t("provider.aliasPlaceholder")}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="xs" onClick={() => setIsRenaming(false)}>
                          {t("common.cancel")}
                        </Button>
                        <Button variant="secondary" size="xs" onClick={handleSaveAlias}>
                          <Check className="size-3" />
                          {t("provider.save")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{t("provider.accountLabel")}</p>
                        <p className="truncate text-sm font-medium">{accountLabel}</p>
                      </div>
                      <Button variant="ghost" size="xs" onClick={handleStartRenaming}>
                        <Pencil className="size-3" />
                        {t("provider.rename")}
                      </Button>
                    </div>
                  )}
                </div>
                {account.sessionHealthReason ? (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    {account.sessionHealthReason}
                  </p>
                ) : null}
              </div>
            </div>

            {pulseStream ? (
              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {copy.flowPulse}
                    </p>
                    <p className="mt-2 text-sm font-semibold">{pulseStream.quotaName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {copy.trendPrefix}: {getTrendLabel(trendCopy, pulseStream.trend)} /{" "}
                      {pulseStream.currentValueLabel ?? copy.trackingProviderUsage}
                    </p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="text-lg font-semibold">
                      {pulseStream.currentRemainingPercent != null
                        ? `${Math.round(pulseStream.currentRemainingPercent)}%`
                        : copy.quotaUnavailable}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatLastFetchedAt(pulseStream.lastSeenAt)}
                    </p>
                  </div>
                </div>
                <PulseSparkline points={pulseStream.points} trend={pulseStream.trend} className="mt-4" />
              </div>
            ) : null}

            <div className="grid gap-3">
              {usageWindows.map((window) => (
                <QuotaPanel key={window.id} window={window} />
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-border/70 pt-3">
              <div className="text-xs text-muted-foreground">
                {account.sourceLabel ? `${copy.fetchedVia(account.sourceLabel)} ` : ""}
                {formatLastFetchedAt(account.lastFetchedAt)}
              </div>
              <Button variant="ghost" size="xs" onClick={() => setConfirmRemoveOpen(true)}>
                <Trash2 className="size-3" />
                {copy.delete}
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4">
            <p className="text-sm text-muted-foreground">
              {account.error ? account.error : t("provider.connectAccount", { provider: meta.name })}
            </p>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.deleteTitle}</DialogTitle>
            <DialogDescription>{copy.deleteDescription(accountLabel)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemoveOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmRemoveOpen(false);
                onRemove?.(account.accountId);
              }}
            >
              {copy.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function QuotaPanel({ window }: { window: ProviderUsageWindow }) {
  const { lang } = useI18n();
  const copy = getProductCopy(lang).providerCard;
  const { quota } = window;
  const remainingPercent = getQuotaRemainingPercent(quota);
  const usedPercent =
    quota.displayMode === "progress" && quota.total > 0
      ? Math.min(100, (quota.used / quota.total) * 100)
      : null;

  if (quota.displayMode === "stat" || quota.total <= 0) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/75 px-4 py-3 text-sm">
        <div>
          <p className="font-medium">{window.label}</p>
          <p className="text-xs text-muted-foreground">
            {quota.resetsAt ? formatResetTime(quota.resetsAt) : copy.directMetric}
          </p>
        </div>
        <span className="text-muted-foreground">
          {quota.valueLabel
            ? quota.valueLabel
            : quota.unit === "USD"
              ? `$${quota.used.toFixed(2)}`
              : `${quota.used.toLocaleString()} ${quota.unit}`}
        </span>
      </div>
    );
  }

  const barColor =
    remainingPercent != null && remainingPercent <= 15
      ? "bg-rose-500"
      : remainingPercent != null && remainingPercent <= 35
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{window.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {quota.valueLabel ??
              `${quota.used.toLocaleString()} / ${quota.total.toLocaleString()} ${quota.unit}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">
            {remainingPercent != null ? `${Math.round(remainingPercent)}%` : copy.quotaUnavailable}
          </p>
          <p className="text-xs text-muted-foreground">
            {quota.resetsAt
              ? formatResetTime(quota.resetsAt) ?? copy.resetUnavailable
              : copy.noResetData}
          </p>
        </div>
      </div>
      <div className="mt-3 h-2.5 w-full rounded-full bg-muted">
        <div
          className={cn("h-2.5 rounded-full transition-all", barColor)}
          style={{ width: `${Math.min(usedPercent ?? 0, 100)}%` }}
        />
      </div>
    </div>
  );
}

function getTrendLabel(
  copy: ReturnType<typeof getProductCopy>["flowPulse"]["trends"],
  trend: PulseStream["trend"]
) {
  if (trend === "rising") return copy.rising;
  if (trend === "falling") return copy.falling;
  if (trend === "steady") return copy.steady;
  return trend;
}
