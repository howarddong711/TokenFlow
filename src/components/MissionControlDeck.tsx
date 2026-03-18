import { useState } from "react";
import {
  Activity,
  Bot,
  Clock3,
  RefreshCw,
  Shield,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { getProductCopy } from "@/i18n/productCopy";
import { formatLastFetchedAt } from "@/lib/monitoring";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@/types";
import { PROVIDERS } from "@/types";
import type { UseMissionControlReturn } from "@/hooks";

interface MissionControlDeckProps {
  mission: UseMissionControlReturn;
  filterProviderId?: ProviderId;
  onOpenProvider: (providerId: ProviderId) => void;
}

export function MissionControlDeck({
  mission,
  filterProviderId,
  onOpenProvider,
}: MissionControlDeckProps) {
  const { lang } = useI18n();
  const productCopy = getProductCopy(lang);
  const copy = productCopy.mission;
  const trendCopy = productCopy.flowPulse.trends;
  const [runningBatch, setRunningBatch] = useState<"refresh" | "repair" | null>(null);

  const queue = filterProviderId
    ? mission.queue.filter((item) => item.providerId === filterProviderId)
    : mission.queue;
  const healthCards = filterProviderId
    ? mission.healthCards.filter((item) => item.providerId === filterProviderId)
    : mission.healthCards;
  const replay = filterProviderId
    ? mission.replay.filter((item) => item.providerId === filterProviderId)
    : mission.replay;
  const runs = filterProviderId
    ? mission.runs.filter((item) => item.providerId === filterProviderId)
    : mission.runs;

  const handleBatchRefresh = async () => {
    if (runningBatch) return;
    setRunningBatch("refresh");
    try {
      await mission.runBatchRefresh();
    } finally {
      setRunningBatch(null);
    }
  };

  const handleBatchRepair = async () => {
    if (runningBatch) return;
    setRunningBatch("repair");
    try {
      await mission.runBatchRepair();
    } finally {
      setRunningBatch(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Bot className="size-3.5" />
                {copy.badge}
              </div>
              <h2 className="mt-3 text-lg font-semibold tracking-tight">{copy.autopilotRules}</h2>
              <p className="text-sm text-muted-foreground">{copy.autopilotRulesBody}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToggleChip
                label={copy.autoStaleRefresh}
                active={mission.prefs.autoRefreshStale}
                onClick={() =>
                  mission.setPrefs({ autoRefreshStale: !mission.prefs.autoRefreshStale })
                }
              />
              <ToggleChip
                label={copy.autoCriticalRefresh}
                active={mission.prefs.autoRefreshCritical}
                onClick={() =>
                  mission.setPrefs({ autoRefreshCritical: !mission.prefs.autoRefreshCritical })
                }
              />
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <StatTile label={copy.queue} value={String(queue.length)} detail={copy.queueDetail} />
            <StatTile
              label={copy.replayWindow}
              value={`${mission.prefs.replayWindowHours}h`}
              detail={copy.replayWindowDetail}
            />
            <StatTile label={copy.runs} value={String(runs.length)} detail={copy.runsDetail} />
          </div>

          <div className="mt-5 rounded-2xl border border-border/70 bg-background/75 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{copy.replayWindow}</p>
                <p className="mt-1 text-xs text-muted-foreground">{copy.replayWindowBody}</p>
              </div>
              <span className="text-sm font-semibold">{mission.prefs.replayWindowHours}h</span>
            </div>
            <input
              type="range"
              min={6}
              max={168}
              step={6}
              value={mission.prefs.replayWindowHours}
              onChange={(event) =>
                mission.setPrefs({ replayWindowHours: Number(event.target.value) })
              }
              className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[var(--primary)]"
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBatchRefresh}
              disabled={runningBatch !== null}
            >
              <RefreshCw className={cn("size-3.5", runningBatch === "refresh" && "animate-spin")} />
              {copy.batchRefresh}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBatchRepair}
              disabled={runningBatch !== null}
            >
              <Wrench className={cn("size-3.5", runningBatch === "repair" && "animate-pulse")} />
              {copy.batchRepair}
            </Button>
          </div>
        </section>

        <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Shield className="size-4" />
            <h2 className="text-lg font-semibold tracking-tight">{copy.providerHealthScore}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{copy.providerHealthScoreBody}</p>
          <div className="mt-5 grid gap-3">
            {healthCards.slice(0, 6).map((card) => (
              <div
                key={card.providerId}
                className="rounded-2xl border border-border/70 bg-background/75 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{PROVIDERS[card.providerId].name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {copy.connectedSignals(card.connectedCount, card.signalCount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-semibold">{card.score}</p>
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                  </div>
                </div>
                <div className="mt-3 h-2.5 w-full rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-2.5 rounded-full",
                      card.score >= 86
                        ? "bg-emerald-500"
                        : card.score >= 68
                          ? "bg-sky-500"
                          : card.score >= 45
                            ? "bg-amber-500"
                            : "bg-rose-500"
                    )}
                    style={{ width: `${card.score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4" />
            <h2 className="text-lg font-semibold tracking-tight">{copy.executionQueue}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{copy.executionQueueBody}</p>
          <div className="mt-5 space-y-3">
            {queue.slice(0, 6).map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-border/70 bg-background/75 p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                          item.priority === "high"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : item.priority === "medium"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-slate-200 bg-slate-50 text-slate-600"
                        )}
                      >
                        {getPriorityLabel(copy, item.priority)}
                      </span>
                      <span className="text-sm font-semibold">{item.title}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    {(item.kind === "refresh" || item.kind === "repair") && item.accountId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void mission.runQueueItem(item)}
                      >
                        {copy.runNow}
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => onOpenProvider(item.providerId)}>
                      {copy.openProvider}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Activity className="size-4" />
            <h2 className="text-lg font-semibold tracking-tight">{copy.replayMonitor}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{copy.replayMonitorBody}</p>
          <div className="mt-5 grid gap-3">
            {replay.slice(0, 6).map((slice) => (
              <div
                key={slice.providerId}
                className="rounded-2xl border border-border/70 bg-background/75 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{PROVIDERS[slice.providerId].name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {copy.samplesInReplay(slice.sampleCount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {slice.averageRemainingPercent != null
                        ? copy.average(slice.averageRemainingPercent)
                        : copy.na}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {getTrendLabel(trendCopy, slice.trend)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 rounded-2xl border border-border/60 bg-card/70 px-3 py-2 text-xs text-muted-foreground">
                  {copy.weakestPoint}:{" "}
                  {slice.weakestRemainingPercent != null
                    ? `${Math.round(slice.weakestRemainingPercent)}%`
                    : copy.na}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-[26px] border border-border/70 bg-card/90 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Clock3 className="size-4" />
          <h2 className="text-lg font-semibold tracking-tight">{copy.missionLog}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{copy.missionLogBody}</p>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {runs.slice(0, 9).map((run) => (
            <div
              key={run.id}
              className="rounded-2xl border border-border/70 bg-background/75 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    run.status === "completed"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  )}
                >
                  {copy.statuses[run.status]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatLastFetchedAt(run.createdAt)}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold">{run.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {PROVIDERS[run.providerId]?.name ?? run.providerId}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{run.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function getPriorityLabel(
  copy: ReturnType<typeof getProductCopy>["mission"],
  priority: "high" | "medium" | "normal"
) {
  if (priority === "high") return copy.priorities.high;
  if (priority === "medium") return copy.priorities.medium;
  return copy.priorities.low;
}

function getTrendLabel(
  copy: ReturnType<typeof getProductCopy>["flowPulse"]["trends"],
  trend: UseMissionControlReturn["replay"][number]["trend"]
) {
  if (trend === "rising") return copy.rising;
  if (trend === "falling") return copy.falling;
  if (trend === "steady") return copy.steady;
  return trend;
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-border/70 bg-background text-muted-foreground hover:border-foreground/15 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
