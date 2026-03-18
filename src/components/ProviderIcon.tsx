import codexIcon from "@/assets/provider-icons/codex.svg";
import codexDarkIcon from "@/assets/provider-icons/codex-dark.png";
import claudeIcon from "@/assets/provider-icons/claude.svg";
import claudeDarkIcon from "@/assets/provider-icons/claude-dark.png";
import qwenIcon from "@/assets/provider-icons/qwen.svg";
import qwenDarkIcon from "@/assets/provider-icons/qwen-dark.png";
import geminiIcon from "@/assets/provider-icons/gemini.svg";
import geminiDarkIcon from "@/assets/provider-icons/gemini-dark.png";
import iflowIcon from "@/assets/provider-icons/iflow.png";
import antigravityIcon from "@/assets/provider-icons/antigravity.svg";
import antigravityDarkIcon from "@/assets/provider-icons/antigravity-dark.png";
import opencodeIcon from "@/assets/provider-icons/opencode.svg";
import opencodeDarkIcon from "@/assets/provider-icons/opencode-dark.png";
import copilotIcon from "@/assets/provider-icons/copilot.svg";
import copilotDarkIcon from "@/assets/provider-icons/copilot-dark.png";
import cursorIcon from "@/assets/provider-icons/cursor.svg";
import cursorDarkIcon from "@/assets/provider-icons/cursor-dark.png";
import traeIcon from "@/assets/provider-icons/trae.svg";
import traeDarkIcon from "@/assets/provider-icons/trae-dark.png";
import kiroIcon from "@/assets/provider-icons/kiro.svg";
import vertexAiIcon from "@/assets/provider-icons/vertexai.svg";
import vertexAiDarkIcon from "@/assets/provider-icons/vertexai-dark.png";
import warpIcon from "@/assets/provider-icons/warp.svg";
import warpDarkIcon from "@/assets/provider-icons/warp-dark.svg";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@/types";

const PROVIDER_ICON_ASSETS: Partial<Record<ProviderId, string>> = {
  codex: codexIcon,
  claude: claudeIcon,
  qwen: qwenIcon,
  gemini: geminiIcon,
  iflow: iflowIcon,
  antigravity: antigravityIcon,
  opencode: opencodeIcon,
  copilot: copilotIcon,
  cursor: cursorIcon,
  trae: traeIcon,
  kiro: kiroIcon,
  vertexai: vertexAiIcon,
  warp: warpIcon,
};

const PROVIDER_DARK_ICON_ASSETS: Partial<Record<ProviderId, string>> = {
  codex: codexDarkIcon,
  claude: claudeDarkIcon,
  qwen: qwenDarkIcon,
  gemini: geminiDarkIcon,
  antigravity: antigravityDarkIcon,
  opencode: opencodeDarkIcon,
  copilot: copilotDarkIcon,
  cursor: cursorDarkIcon,
  trae: traeDarkIcon,
  vertexai: vertexAiDarkIcon,
  warp: warpDarkIcon,
};

export function ProviderIcon({
  providerId,
  size = 18,
  className,
}: {
  providerId: ProviderId;
  size?: number;
  className?: string;
}) {
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");
  const src =
    (isDark ? PROVIDER_DARK_ICON_ASSETS[providerId] : undefined) ??
    PROVIDER_ICON_ASSETS[providerId];

  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={cn("shrink-0 object-contain", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-border/60 bg-background text-[10px] font-semibold uppercase text-muted-foreground",
        className
      )}
      style={{ width: size, height: size }}
    >
      {providerId.slice(0, 1)}
    </span>
  );
}

export function ProviderColorBadge({
  color,
  size = 8,
  className,
}: {
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-background ring-1 ring-border/80 shadow-[0_1px_3px_rgba(15,23,42,0.16)]",
        className
      )}
      style={{ width: size + 4, height: size + 4 }}
    >
      <span
        className="rounded-full ring-1 ring-black/10"
        style={{ width: size, height: size, backgroundColor: color }}
      />
    </span>
  );
}
