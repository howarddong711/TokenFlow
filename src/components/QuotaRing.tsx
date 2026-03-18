import { cn } from "@/lib/utils";
import { getQuotaRemainingPercent } from "@/lib/monitoring";
import type { ProviderUsageWindow } from "@/types";

interface QuotaRingProps {
  window: ProviderUsageWindow;
  color?: string;
  compact?: boolean;
  hideMeta?: boolean;
  tiny?: boolean;
  sideLabel?: string;
  sizeOverride?: number;
  sideLabelSize?: number;
}

export function QuotaRing({
  window,
  color = "var(--primary)",
  compact,
  hideMeta,
  tiny,
  sideLabel,
  sizeOverride,
  sideLabelSize,
}: QuotaRingProps) {
  const remaining = getQuotaRemainingPercent(window.quota);
  const balance = remaining == null ? 0 : remaining;
  const size = sizeOverride ?? (tiny ? 54 : compact ? 68 : 82);
  const stroke = tiny ? 6 : compact ? 8 : 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (balance / 100) * circumference;

  return (
    <div
      className={cn(
        "flex min-w-[88px] flex-col items-center gap-2",
        compact && "min-w-[72px]",
        tiny && "min-w-[86px] gap-1",
        sideLabel && "min-w-0 flex-row items-center gap-2.5"
      )}
      title={`${window.label}${window.quota.valueLabel ? ` · ${window.quota.valueLabel}` : ""}`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="color-mix(in oklab, var(--border) 88%, transparent)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-center">
          <span className={cn("font-semibold", tiny ? "text-[11px]" : "text-sm")}>
            {remaining != null ? `${Math.round(remaining)}%` : "n/a"}
          </span>
        </div>
      </div>
      {sideLabel ? (
        <span
          className={cn("font-medium text-muted-foreground", tiny ? "text-[12px]" : "text-[11px]")}
          style={sideLabelSize ? { fontSize: `${sideLabelSize}px` } : undefined}
        >
          {sideLabel}
        </span>
      ) : null}
      {!hideMeta ? (
        <div className="text-center">
          <p className="text-[11px] font-medium text-foreground">{window.label}</p>
          <p className="text-[11px] text-muted-foreground">{window.quota.valueLabel ?? ""}</p>
        </div>
      ) : null}
    </div>
  );
}
