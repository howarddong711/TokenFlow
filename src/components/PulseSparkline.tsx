import { cn } from "@/lib/utils";
import type { PulseSample, PulseTrend } from "@/types";

interface PulseSparklineProps {
  points: PulseSample[];
  trend?: PulseTrend;
  className?: string;
}

export function PulseSparkline({
  points,
  trend = "unknown",
  className,
}: PulseSparklineProps) {
  const values = points
    .map((point) => point.remainingPercent)
    .filter((value): value is number => typeof value === "number");

  if (values.length < 2) {
    return (
      <div
        className={cn(
          "flex h-14 items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/60 text-[11px] text-muted-foreground",
          className
        )}
      >
        Waiting for more history
      </div>
    );
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const path = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const normalized = (value - min) / span;
      const y = 88 - normalized * 76;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const tone =
    trend === "falling"
      ? "text-rose-500"
      : trend === "rising"
        ? "text-emerald-500"
        : "text-sky-500";

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn("h-14 w-full overflow-visible", tone, className)}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
