import type { ReactNode } from "react";
import {
  FileClock,
  Info,
  KeyRound,
  LayoutDashboard,
  PanelsTopLeft,
  Settings2,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { getWorkspaceCopy } from "@/i18n/workspaceCopy";
import { cn } from "@/lib/utils";
import appLogo from "../../src-tauri/icons/128x128.png";

export type WorkspacePageId = "dashboard" | "providers" | "apiKeys" | "logs" | "settings" | "about";

interface SidebarProps {
  activePage: WorkspacePageId;
  onSelectPage: (page: WorkspacePageId) => void;
}

export function Sidebar({ activePage, onSelectPage }: SidebarProps) {
  const { lang } = useI18n();
  const copy = getWorkspaceCopy(lang);

  return (
    <aside
      className="flex w-[176px] shrink-0 flex-col border-r border-sidebar-border/55 bg-sidebar-background/82 backdrop-blur-xl"
    >
      <div className="border-b border-sidebar-border/55 px-3 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-sidebar-border/55 bg-card/88 dark:border-white/10 dark:bg-white/7 dark:shadow-[0_6px_18px_rgba(0,0,0,0.22)]">
            <img src={appLogo} alt="TokenFlow logo" className="size-8 object-contain" />
          </div>
          <div>
            <p className="text-[18px] font-bold leading-none tracking-[-0.045em] text-foreground/92">
              TokenFlow
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 p-3">
        <NavButton
          active={activePage === "dashboard"}
          icon={<LayoutDashboard className="size-4" />}
          label={copy.nav.dashboard}
          onClick={() => onSelectPage("dashboard")}
        />
        <NavButton
          active={activePage === "providers"}
          icon={<PanelsTopLeft className="size-4" />}
          label={copy.nav.providers}
          onClick={() => onSelectPage("providers")}
        />
        <NavButton
          active={activePage === "apiKeys"}
          icon={<KeyRound className="size-4" />}
          label={copy.nav.apiKeys}
          onClick={() => onSelectPage("apiKeys")}
        />
        <NavButton
          active={activePage === "logs"}
          icon={<FileClock className="size-4" />}
          label={copy.nav.logs}
          onClick={() => onSelectPage("logs")}
        />
        <NavButton
          active={activePage === "settings"}
          icon={<Settings2 className="size-4" />}
          label={copy.nav.settings}
          onClick={() => onSelectPage("settings")}
        />
        <NavButton
          active={activePage === "about"}
          icon={<Info className="size-4" />}
          label={copy.nav.about}
          onClick={() => onSelectPage("about")}
        />
      </nav>
    </aside>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[16px] px-2.5 py-2 text-left text-[12px] font-medium transition",
        active
          ? "border border-primary/24 bg-primary/10 text-primary shadow-[0_8px_20px_rgba(37,99,235,0.10)]"
          : "text-sidebar-foreground hover:bg-sidebar-accent/50"
      )}
    >
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-[12px]",
          active
            ? "bg-background/88 text-primary shadow-sm dark:bg-card/80"
            : "bg-background/70 text-muted-foreground dark:bg-card/55"
        )}
      >
        {icon}
      </div>
      <span className="leading-4">{label}</span>
    </button>
  );
}
