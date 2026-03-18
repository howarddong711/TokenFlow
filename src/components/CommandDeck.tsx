import { useMemo, useState } from "react";
import {
  Bell,
  BellOff,
  CheckCheck,
  Clock3,
  Download,
  ExternalLink,
  PauseCircle,
  Radar,
  Search,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { getProductCopy } from "@/i18n/productCopy";
import { formatLastFetchedAt } from "@/lib/monitoring";
import { cn } from "@/lib/utils";
import { PROVIDERS } from "@/types";
import type { ProviderId, PulseSignal } from "@/types";
import type { UseCommandCenterReturn } from "@/hooks";

interface CommandDeckProps {
  command: UseCommandCenterReturn;
  filterProviderId?: ProviderId;
  onOpenProvider: (providerId: ProviderId) => void;
}

type SignalFilter = "all" | "critical" | "warning";

export function CommandDeck({
  command,
  filterProviderId,
  onOpenProvider,
}: CommandDeckProps) {
  const { lang } = useI18n();
  const copy = getProductCopy(lang).command;
  const [query, setQuery] = useState("");
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("all");

  const baseInboxSignals = filterProviderId
    ? command.inboxSignals.filter((signal) => signal.providerId === filterProviderId)
    : command.inboxSignals;
  const filteredInboxSignals = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return baseInboxSignals.filter((signal) => {
      const matchesLevel = signalFilter === "all" || signal.level === signalFilter;
      if (!matchesLevel) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack =
        `${signal.title} ${signal.detail} ${signal.accountLabel} ${signal.providerId}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [baseInboxSignals, query, signalFilter]);

  const actions = filterProviderId
    ? command.actions.filter((action) => action.providerId === filterProviderId)
    : command.actions;
  const history = filterProviderId
    ? command.history.filter((event) => event.providerId === filterProviderId)
    : command.history;
  const diagnostics = filterProviderId
    ? command.diagnostics.filter((item) => item.providerId === filterProviderId)
    : command.diagnostics;

  const filterLabels: Record<SignalFilter, string> = {
    all: copy.filters.all,
    critical: copy.filters.critical,
    warning: copy.filters.warning,
  };

  return (
    <section className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Workflow className="size-3.5" />
                {copy.badge}
              </div>
              <h2 className="mt-3 text-lg font-semibold tracking-tight">{copy.incidentInbox}</h2>
              <p className="text-sm text-muted-foreground">{copy.incidentInboxBody}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={command.prefs.desktopNotifications ? "outline" : "secondary"}
                size="sm"
                onClick={() => command.setDesktopNotifications(!command.prefs.desktopNotifications)}
              >
                {command.prefs.desktopNotifications ? (
                  <Bell className="size-3.5" />
                ) : (
                  <BellOff className="size-3.5" />
                )}
                {command.prefs.desktopNotifications ? copy.notificationsOn : copy.notificationsOff}
              </Button>
              {command.notificationsAvailable &&
              command.notificationPermission !== "granted" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void command.requestNotificationPermission()}
                >
                  <Bell className="size-3.5" />
                  {copy.allowDesktopAlerts}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => command.snoozeFor(30)}>
              <PauseCircle className="size-3.5" />
              {copy.snooze30m}
            </Button>
            <Button variant="outline" size="sm" onClick={() => command.snoozeFor(120)}>
              <Clock3 className="size-3.5" />
              {copy.quiet2h}
            </Button>
            {command.isQuietMode ? (
              <Button variant="secondary" size="sm" onClick={command.clearQuietMode}>
                {copy.resumeNow}
                {command.quietMinutesRemaining != null
                  ? ` (${copy.minutesLeft(command.quietMinutesRemaining)})`
                  : ""}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => command.exportSnapshot("json")}>
              <Download className="size-3.5" />
              {copy.exportJson}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => command.exportSnapshot("markdown")}>
              <Download className="size-3.5" />
              {copy.exportMd}
            </Button>
          </div>

          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="h-10 w-full rounded-2xl border border-border/70 bg-background pl-10 pr-4 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {(["all", "critical", "warning"] as SignalFilter[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setSignalFilter(item)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    signalFilter === item
                      ? "border-foreground/15 bg-foreground text-background"
                      : "border-border/70 bg-background text-muted-foreground hover:border-foreground/15 hover:text-foreground"
                  )}
                >
                  {filterLabels[item]}
                </button>
              ))}
            </div>
          </div>

          {filteredInboxSignals.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/70 px-4 py-5 text-sm text-emerald-800">
              {copy.inboxClear}
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {filteredInboxSignals.slice(0, 6).map((signal) => (
                <InboxSignalCard
                  key={signal.id}
                  signal={signal}
                  onAcknowledge={() => command.acknowledgeSignal(signal.id)}
                  onOpenProvider={() => onOpenProvider(signal.providerId)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Radar className="size-4" />
            <h2 className="text-lg font-semibold tracking-tight">{copy.actionRunway}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{copy.actionRunwayBody}</p>

          {actions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border/70 bg-background/70 px-4 py-5 text-sm text-muted-foreground">
              {copy.noActions}
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {actions.map((action) => (
                <div
                  key={action.id}
                  className="rounded-2xl border border-border/70 bg-background/75 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            action.level === "critical"
                              ? "border-rose-200 bg-rose-50 text-rose-700"
                              : action.level === "warning"
                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                : "border-slate-200 bg-slate-50 text-slate-600"
                          )}
                        >
                          {getActionLevelLabel(copy, action.level)}
                        </span>
                        <span className="text-sm font-semibold">{action.title}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {action.detail}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenProvider(action.providerId)}
                    >
                      <ExternalLink className="size-3.5" />
                      {action.actionLabel || copy.openProvider}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            <h2 className="text-lg font-semibold tracking-tight">{copy.providerDiagnostics}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{copy.providerDiagnosticsBody}</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {diagnostics.slice(0, 6).map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-border/70 bg-background/75 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {PROVIDERS[item.providerId]?.name} / {item.accountLabel}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.authPath}</p>
                    <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {item.kind === "duplicate"
                        ? copy.diagnosticKinds.duplicate
                        : copy.diagnosticKinds.account}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                      item.sessionState === "error" || item.sessionState === "repair"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : item.sessionState === "watch"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : item.sessionState === "offline"
                            ? "border-slate-200 bg-slate-50 text-slate-600"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    )}
                  >
                    {copy.sessionStates[item.sessionState]}
                  </span>
                </div>
                {item.kind === "duplicate" ? (
                  <>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {copy.duplicateSummary(item.duplicateCount ?? 0)}
                      {item.duplicateMatchKind
                        ? ` · ${copy.duplicateMatchLabels[item.duplicateMatchKind]}`
                        : ""}
                    </p>
                    {item.relatedAccounts?.length ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {item.relatedAccounts.join(" · ")}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {item.headlineWindowLabel
                      ? `${item.headlineWindowLabel} / ${
                          item.remainingPercent != null
                            ? `${Math.round(item.remainingPercent)}%`
                            : copy.noHeadlineWindowYet
                        }`
                      : copy.noHeadlineWindowYet}
                  </p>
                )}
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.nextStep}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatLastFetchedAt(item.lastSeenAt)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCheck className="size-4" />
            <h2 className="text-lg font-semibold tracking-tight">{copy.recentHistory}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{copy.recentHistoryBody}</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {history.slice(0, 8).map((event) => (
              <div
                key={event.id}
                className="rounded-2xl border border-border/70 bg-background/75 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                      event.kind === "opened"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : event.kind === "resolved"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-sky-200 bg-sky-50 text-sky-700"
                    )}
                  >
                    {copy.historyKinds[event.kind]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatLastFetchedAt(event.createdAt)}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold">{event.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {PROVIDERS[event.providerId]?.name ?? event.providerId}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{event.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function InboxSignalCard({
  signal,
  onAcknowledge,
  onOpenProvider,
}: {
  signal: PulseSignal;
  onAcknowledge: () => void;
  onOpenProvider: () => void;
}) {
  const { lang } = useI18n();
  const copy = getProductCopy(lang).command;

  return (
    <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                signal.level === "critical"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              )}
            >
              {getActionLevelLabel(copy, signal.level)}
            </span>
            <span className="text-sm font-semibold">{signal.title}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {PROVIDERS[signal.providerId]?.name} / {signal.accountLabel}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{signal.detail}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <Button variant="outline" size="sm" onClick={onOpenProvider}>
            {copy.openProvider}
          </Button>
          <Button variant="secondary" size="sm" onClick={onAcknowledge}>
            {copy.acknowledge}
          </Button>
        </div>
      </div>
    </div>
  );
}

function getActionLevelLabel(
  copy: ReturnType<typeof getProductCopy>["command"],
  level: PulseSignal["level"] | "normal"
) {
  if (level === "critical") return copy.actionLevels.critical;
  if (level === "warning") return copy.actionLevels.warning;
  return copy.actionLevels.info;
}
