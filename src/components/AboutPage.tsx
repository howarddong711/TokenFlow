import { Download, Github, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openInBrowser } from "@/services/browser";
import { useI18n } from "@/i18n";
import { getWorkspaceCopy } from "@/i18n/workspaceCopy";
import appLogo from "../../src-tauri/icons/128x128.png";

interface AboutPageProps {
  version: string;
  projectUrl?: string;
  donateUrl?: string;
}

export function AboutPage({
  version,
  projectUrl = "https://github.com/howarddong711",
  donateUrl,
}: AboutPageProps) {
  const { lang } = useI18n();
  const copy = getWorkspaceCopy(lang);

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
            <Button variant="default" onClick={() => projectUrl && void openInBrowser(projectUrl)}>
              <Download className="size-4" />
              {copy.common.checkUpdates}
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
        </div>
      </div>
    </div>
  );
}
