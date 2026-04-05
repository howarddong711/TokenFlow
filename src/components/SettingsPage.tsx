import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Download, Languages, MoonStar, Palette, PlayCircle, Shield, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProviderColorBadge, ProviderIcon } from "@/components/ProviderIcon";
import { useI18n } from "@/i18n";
import { getWorkspaceCopy } from "@/i18n/workspaceCopy";
import type { WorkspaceTheme } from "@/hooks/useWorkspacePreferences";
import { FOCUSED_PROVIDER_IDS } from "@/lib/provider-focus";
import type { ProviderId } from "@/types";
import { PROVIDERS } from "@/types";

interface SettingsPageProps {
  theme: WorkspaceTheme;
  privacyMode: boolean;
  launchOnStartup: boolean;
  autoUpdate: boolean;
  autoUpdateSupported: boolean;
  providerColors: Record<ProviderId, string>;
  onThemeChange: (theme: WorkspaceTheme) => void;
  onPrivacyModeChange: (enabled: boolean) => void;
  onLaunchOnStartupChange: (enabled: boolean) => void;
  onAutoUpdateChange: (enabled: boolean) => void;
  onProviderColorChange: (providerId: ProviderId, color: string) => void;
  onResetProviderColors: () => void;
}

const LANGUAGE_OPTIONS = [
  { value: "zh", label: "\u4e2d\u6587" },
  { value: "en", label: "English" },
] as const;

export function SettingsPage({
  theme,
  privacyMode,
  launchOnStartup,
  autoUpdate,
  autoUpdateSupported,
  providerColors,
  onThemeChange,
  onPrivacyModeChange,
  onLaunchOnStartupChange,
  onAutoUpdateChange,
  onProviderColorChange,
  onResetProviderColors,
}: SettingsPageProps) {
  const { lang, setLang } = useI18n();
  const copy = getWorkspaceCopy(lang);
  const [confirmResetColorsOpen, setConfirmResetColorsOpen] = useState(false);

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/90">
        <CardContent className="grid gap-3 p-4 xl:grid-cols-2">
          <ThemeTile theme={theme} copy={copy} onChange={onThemeChange} />
          <ToggleTile
            icon={<Shield className="size-4" />}
            label={copy.settings.privacy}
            value={privacyMode ? copy.settings.enabled : copy.settings.disabled}
            checked={privacyMode}
            onChange={onPrivacyModeChange}
          />
          <ToggleTile
            icon={<PlayCircle className="size-4" />}
            label={copy.settings.launchOnStartup}
            value={launchOnStartup ? copy.settings.enabled : copy.settings.disabled}
            checked={launchOnStartup}
            onChange={onLaunchOnStartupChange}
          />
          <ToggleTile
            icon={<Download className="size-4" />}
            label={copy.settings.autoUpdate}
            value={
              autoUpdateSupported
                ? autoUpdate
                  ? copy.settings.enabled
                  : copy.settings.disabled
                : copy.settings.unavailable
            }
            checked={autoUpdate}
            disabled={!autoUpdateSupported}
            onChange={onAutoUpdateChange}
          />
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Languages className="size-4" />
            {copy.settings.language}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
          {LANGUAGE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={lang === option.value ? "default" : "outline"}
              size="sm"
              onClick={() => setLang(option.value)}
            >
              {option.label}
            </Button>
          ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/90">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Palette className="size-4" />
                {copy.settings.providerColors}
              </CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">{copy.settings.providerColorsHelp}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setConfirmResetColorsOpen(true)}>
              {copy.settings.resetColors}
            </Button>
            <Dialog open={confirmResetColorsOpen} onOpenChange={setConfirmResetColorsOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{copy.settings.resetColorsTitle}</DialogTitle>
                  <DialogDescription>{copy.settings.resetColorsDescription}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmResetColorsOpen(false)}>
                    {copy.common.close}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      onResetProviderColors();
                      setConfirmResetColorsOpen(false);
                    }}
                  >
                    {copy.settings.resetColors}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-2 md:grid-cols-3">
            {FOCUSED_PROVIDER_IDS.map((providerId) => (
              <ProviderColorRow
                key={providerId}
                providerId={providerId}
                color={providerColors[providerId]}
                onChange={onProviderColorChange}
              />
            ))}
          </div>

          <div className="flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                void invoke("quit_app");
              }}
            >
              {copy.settings.quit}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderColorRow({
  providerId,
  color,
  onChange,
}: {
  providerId: ProviderId;
  color: string;
  onChange: (providerId: ProviderId, color: string) => void;
}) {
  const [channels, setChannels] = useState(() => hexToRgbChannels(color));

  useEffect(() => {
    setChannels(hexToRgbChannels(color));
  }, [color]);

  const commitChannel = (channel: "r" | "g" | "b", value: string) => {
    const next = {
      ...channels,
      [channel]: clampRgb(value),
    };
    setChannels(next);
    onChange(providerId, rgbChannelsToHex(next));
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_50px_50px_50px] items-center gap-1 rounded-xl border border-border/70 bg-background/70 px-2.5 py-2">
      <div className="min-w-0 pr-1">
        <div className="flex items-center gap-2">
          <div className="relative shrink-0">
            <ProviderIcon providerId={providerId} size={16} />
            <ProviderColorBadge color={color} size={8} className="absolute -bottom-1 -right-1" />
          </div>
          <p className="truncate text-[13px] font-medium leading-tight">
            {PROVIDERS[providerId].name}
          </p>
        </div>
        <p className="truncate text-[11px] leading-tight text-muted-foreground">{providerId}</p>
      </div>
      <RgbInput
        value={channels.r}
        onChange={(value) => commitChannel("r", value)}
        ariaLabel={`${PROVIDERS[providerId].name} red`}
      />
      <RgbInput
        value={channels.g}
        onChange={(value) => commitChannel("g", value)}
        ariaLabel={`${PROVIDERS[providerId].name} green`}
      />
      <RgbInput
        value={channels.b}
        onChange={(value) => commitChannel("b", value)}
        ariaLabel={`${PROVIDERS[providerId].name} blue`}
      />
    </div>
  );
}

function RgbInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      min={0}
      max={255}
      step={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className="h-8 w-full rounded-lg border border-border/70 bg-card px-1 text-center text-[12px] font-medium tabular-nums outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
    />
  );
}

function hexToRgbChannels(color: string) {
  const normalized = color.replace("#", "").padStart(6, "0").slice(0, 6);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) || 0,
    g: Number.parseInt(normalized.slice(2, 4), 16) || 0,
    b: Number.parseInt(normalized.slice(4, 6), 16) || 0,
  };
}

function rgbChannelsToHex({
  r,
  g,
  b,
}: {
  r: number;
  g: number;
  b: number;
}) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value: number) {
  return clampRgb(value).toString(16).padStart(2, "0");
}

function clampRgb(value: string | number) {
  const numeric = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(numeric)));
}

function ToggleTile({
  icon,
  label,
  value,
  checked,
  cycle = false,
  disabled = false,
  onChange,
  onCycle,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  checked: boolean;
  cycle?: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  onCycle?: () => void;
}) {
  return (
    <label
      className={`flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-4 py-3 ${disabled ? "opacity-80" : "cursor-pointer"}`}
    >
      <span className="flex items-center gap-3">
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        <span className="text-sm font-medium">{label}</span>
      </span>
      <span className="flex items-center gap-3">
        <span className="text-xs font-semibold text-foreground/90">{value}</span>
        <button
          type="button"
          onClick={() => {
            if (!disabled) {
              if (cycle) {
                onCycle?.();
              } else {
                onChange(!checked);
              }
            }
          }}
          disabled={disabled}
          className={`relative h-7 w-12 rounded-full border transition ${
            checked
              ? "border-primary/30 bg-primary"
              : "border-border bg-muted"
          }`}
        >
          <span
            className={`absolute top-1 size-5 rounded-full border border-black/10 bg-white shadow-md transition ${
              checked ? "left-6" : "left-1"
            }`}
          />
        </button>
      </span>
    </label>
  );
}

function ThemeTile({
  theme,
  copy,
  onChange,
}: {
  theme: WorkspaceTheme;
  copy: ReturnType<typeof getWorkspaceCopy>;
  onChange: (theme: WorkspaceTheme) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
      <span className="flex items-center gap-3">
        {theme === "dark" ? (
          <MoonStar className="size-4 text-muted-foreground" />
        ) : theme === "light" ? (
          <Sun className="size-4 text-muted-foreground" />
        ) : (
          <Languages className="size-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">{copy.settings.theme}</span>
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={theme === "light" ? "default" : "outline"}
          onClick={() => onChange("light")}
        >
          {copy.settings.light}
        </Button>
        <Button
          size="sm"
          variant={theme === "dark" ? "default" : "outline"}
          onClick={() => onChange("dark")}
        >
          {copy.settings.dark}
        </Button>
        <Button
          size="sm"
          variant={theme === "system" ? "default" : "outline"}
          onClick={() => onChange("system")}
        >
          {copy.settings.system}
        </Button>
      </div>
    </div>
  );
}
