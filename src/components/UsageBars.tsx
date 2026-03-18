import { useState } from "react";

import { formatCompactNumber, type DashboardBarDatum } from "@/lib/workspace-analytics";
import { cn } from "@/lib/utils";
import { PROVIDERS, type ProviderId } from "@/types";

export interface UsageBarsLayout {
  chartHeight: number;
  plotHeight: number;
  barWidth: number;
}

interface UsageBarsProps {
  bars: DashboardBarDatum[];
  emptyText: string;
  valueLabel: string;
  activeProviderId?: ProviderId | null;
  layout?: UsageBarsLayout;
  className?: string;
  embedded?: boolean;
}

export function UsageBars({
  bars,
  emptyText,
  valueLabel,
  activeProviderId,
  layout,
  className,
  embedded = false,
}: UsageBarsProps) {
  const [hoveredSegmentKey, setHoveredSegmentKey] = useState<string | null>(null);
  const displayBars = activeProviderId
    ? bars.map((bar) => {
        const segments = bar.segments.filter(
          (segment) => segment.providerId === activeProviderId
        );
        return {
          ...bar,
          segments,
          total: segments.reduce((sum, segment) => sum + segment.value, 0),
        };
      })
    : bars;
  const max = Math.max(...displayBars.map((bar) => bar.total), 0);
  const hasData = max > 0;
  const chartHeight = layout?.chartHeight ?? 160;
  const plotHeight = layout?.plotHeight ?? 134;
  const barWidth = layout?.barWidth ?? 18;
  const emptyHeight = Math.max(chartHeight + 26, 150);
  const activeProviderName = activeProviderId ? PROVIDERS[activeProviderId].name : null;

  return (
    <div
      className={cn(
        embedded
          ? "rounded-[20px] border border-border/50 bg-background/55 p-2.5"
          : "rounded-[28px] border border-border/70 bg-card/90 p-5 shadow-sm",
        className
      )}
    >
      {!hasData ? (
        <div
          className="flex items-center justify-center rounded-[18px] border border-dashed border-border/70 bg-background/60 text-sm text-muted-foreground"
          style={{ height: `${emptyHeight}px` }}
        >
          {emptyText}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-end">
            <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80 shadow-sm">
              {`MAX ${formatCompactNumber(max)} ${valueLabel}${activeProviderName ? ` · ${activeProviderName}` : ""}`}
            </span>
          </div>
          <div
            className="relative px-1.5 pb-0.5 pt-1"
            onMouseLeave={() => setHoveredSegmentKey(null)}
          >
            <div className="relative flex items-end gap-1" style={{ height: `${chartHeight}px` }}>
              {displayBars.map((bar) => (
                <div key={bar.dateKey} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div
                    className="flex w-full items-end justify-center"
                    style={{ height: `${plotHeight}px` }}
                  >
                    <div
                      className="relative flex h-full w-full flex-col justify-end overflow-hidden rounded-t-[999px]"
                      style={{ maxWidth: `${barWidth}px` }}
                    >
                      <div className="absolute inset-0 rounded-t-[999px] border border-border/10 bg-[linear-gradient(180deg,rgba(148,163,184,0.04),rgba(148,163,184,0.01))]" />
                      <div className="relative flex h-full flex-col justify-end overflow-hidden rounded-t-[999px]">
                        {bar.segments.map((segment, index) => {
                          const segmentKey = `${bar.dateKey}:${segment.providerId}`;
                          const isHovered = hoveredSegmentKey === segmentKey;
                          const hasHoveredSegment = hoveredSegmentKey !== null;
                          const isDimmed = hasHoveredSegment && !isHovered;

                          return (
                            <div
                              key={segmentKey}
                              onMouseEnter={() => setHoveredSegmentKey(segmentKey)}
                              className={cn(
                                "transition-[filter,transform,box-shadow,opacity] duration-150",
                                index === 0 && "rounded-t-[999px]"
                              )}
                              style={{
                                height: `${(segment.value / max) * 100}%`,
                                backgroundColor: segment.color,
                                opacity: isDimmed ? 0.34 : 1,
                                transform: isHovered ? "scale(1.14)" : "scale(1)",
                                transformOrigin: "center bottom",
                                boxShadow: isHovered
                                  ? `0 0 0 2px color-mix(in srgb, ${segment.color} 32%, white), 0 14px 30px color-mix(in srgb, ${segment.color} 36%, transparent)`
                                  : index === 0
                                    ? `0 0 0 1px color-mix(in srgb, ${segment.color} 20%, transparent), 0 6px 18px color-mix(in srgb, ${segment.color} 12%, transparent)`
                                    : undefined,
                                filter: isDimmed
                                  ? "brightness(1.05) saturate(0.82)"
                                  : isHovered
                                    ? "brightness(1.24) saturate(1.25)"
                                    : "none",
                                position: isHovered ? "relative" : undefined,
                                zIndex: isHovered ? 2 : 1,
                              }}
                              title={`${PROVIDERS[segment.providerId].name} | ${formatCompactNumber(segment.value)} ${valueLabel}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <span className="text-[9px] leading-none text-muted-foreground/90">
                    {bar.label.slice(3)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
