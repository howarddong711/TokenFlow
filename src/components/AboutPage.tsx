import { Download, Github, Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { openInBrowser } from "@/services/browser";
import { useI18n } from "@/i18n";
import { getWorkspaceCopy } from "@/i18n/workspaceCopy";
import type { AppUpdaterState } from "@/hooks";
import appLogo from "../../src-tauri/icons/128x128.png";

interface AboutPageProps {
  version: string;
  projectUrl?: string;
  donateUrl?: string;
  autoUpdateEnabled: boolean;
  updateState: AppUpdaterState;
  onCheckUpdates: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
}

export function AboutPage({
  version,
  projectUrl = "https://github.com/howarddong711/TokenFlow#",
  donateUrl,
  autoUpdateEnabled,
  updateState,
  onCheckUpdates,
  onInstallUpdate,
}: AboutPageProps) {
  const { lang } = useI18n();
  const copy = getWorkspaceCopy(lang);
  const isChecking = updateState.phase === "checking";
  const isInstalling = updateState.phase === "installing";
  const canInstall = updateState.phase === "available";
  const updateSummary = getUpdateSummary(copy, updateState);

  return (
    <div className="flex justify-center px-2 pb-6 pt-2">
      <div className="w-full max-w-4xl">
        <div className="flex flex-col items-center text-center">
          <div className="flex size-24 items-center justify-center overflow-hidden rounded-[28px] border border-border/70 bg-card/90 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
            <img src={appLogo} alt="TokenFlow logo" className="size-16 object-contain" />
          </div>

          <h2 className="mt-6 text-5xl font-semibold tracking-tight text-foreground">
            {copy.common.appName}
          </h2>

          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
            {copy.about.subtitle}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <span className="rounded-full border border-primary/18 bg-primary/8 px-4 py-1.5 text-sm font-medium text-primary">
              {copy.common.currentVersion} {version}
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button variant="default" onClick={() => void onCheckUpdates()} disabled={isChecking || isInstalling}>
              {isChecking || isInstalling ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {isChecking ? copy.about.checkingUpdates : copy.common.checkUpdates}
            </Button>
            <Button
              variant="outline"
              onClick={() => projectUrl && void openInBrowser(projectUrl)}
              disabled={!projectUrl}
            >
              <Github className="size-4" />
              GitHub
            </Button>
            <Button
              variant="outline"
              onClick={() => donateUrl && void openInBrowser(donateUrl)}
              disabled={!donateUrl}
            >
              <Heart className="size-4" />
              {copy.common.supportProject}
            </Button>
          </div>

          <Card className="mt-8 w-full border-border/70 bg-card/90 text-left">
            <CardHeader>
              <CardTitle>{copy.about.updateStatusTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">{updateSummary}</p>
              {autoUpdateEnabled ? (
                <p className="text-xs text-muted-foreground">{copy.about.autoUpdateEnabled}</p>
              ) : null}
              {updateState.checkedAt ? (
                <p className="text-xs text-muted-foreground">
                  {copy.about.lastChecked(formatUpdateTimestamp(updateState.checkedAt))}
                </p>
              ) : null}
              {updateState.phase === "available" && updateState.update.notes ? (
                <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <p className="text-sm font-medium text-foreground">{copy.about.releaseNotes}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {updateState.update.notes}
                  </p>
                </div>
              ) : null}
              {canInstall ? (
                <div className="flex justify-end">
                  <Button onClick={() => void onInstallUpdate()} disabled={isInstalling}>
                    {isInstalling ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {copy.about.installUpdate}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function getUpdateSummary(
  copy: ReturnType<typeof getWorkspaceCopy>,
  updateState: AppUpdaterState
) {
  switch (updateState.phase) {
    case "checking":
      return copy.about.updateChecking;
    case "upToDate":
      return copy.about.updateCurrent;
    case "available":
      return copy.about.updateAvailable(
        updateState.update.version,
        updateState.update.currentVersion
      );
    case "installing":
      return copy.about.updateInstalling;
    case "installed":
      return copy.about.updateInstalled;
    case "error":
      return copy.about.updateError(updateState.error);
    default:
      return copy.about.updateIdle;
  }
}

function formatUpdateTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
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
