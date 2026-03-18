/**
 * OAuthFlowDialog — Reusable OAuth authorization flow UI
 *
 * Shows progress through OAuth browser-redirect flow for providers
 * like Anti-Gravity and iFlow.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { useEffect } from "react";

export type OAuthFlowStatus =
  | "idle"
  | "starting"
  | "waiting"
  | "exchanging"
  | "fetching"
  | "success"
  | "error";

export interface OAuthFlowState {
  status: OAuthFlowStatus;
  statusText?: string;
  error?: string;
  detailLines?: string[];
}

interface OAuthFlowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
  state: OAuthFlowState;
  onStartFlow: () => void;
}

export function OAuthFlowDialog({
  open,
  onOpenChange,
  providerName,
  state,
  onStartFlow,
}: OAuthFlowDialogProps) {
  const { t } = useI18n();
  const statusMessages: Record<OAuthFlowStatus, string> = {
    idle: "",
    starting: t("oauthDialog.starting"),
    waiting: t("oauthDialog.waiting"),
    exchanging: t("oauthDialog.exchanging"),
    fetching: t("oauthDialog.fetching"),
    success: t("oauthDialog.success"),
    error: t("oauthDialog.failed"),
  };
  const statusMessage = state.statusText || statusMessages[state.status];
  const isInProgress = ["starting", "waiting", "exchanging", "fetching"].includes(
    state.status
  );

  useEffect(() => {
    if (!open || state.status !== "success") {
      return;
    }

    const timer = window.setTimeout(() => onOpenChange(false), 1000);
    return () => window.clearTimeout(timer);
  }, [open, onOpenChange, state.status]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("oauthDialog.title", { provider: providerName })}</DialogTitle>
          <DialogDescription>{t("oauthDialog.description", { provider: providerName })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {state.status === "idle" && (
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("oauthDialog.idleBody", { provider: providerName })}
              </p>
              <Button onClick={onStartFlow} className="w-full">
                <ExternalLink className="size-4" />
                {t("oauthDialog.signIn", { provider: providerName })}
              </Button>
            </div>
          )}

          {isInProgress && (
            <div className="text-center space-y-3">
              <Loader2 className="size-10 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
              {state.status === "waiting" && (
                <p className="text-xs text-muted-foreground">
                  {t("oauthDialog.waitingBody")}
                </p>
              )}
            </div>
          )}

          {state.status === "success" && (
            <div className="text-center space-y-2">
              <CheckCircle2 className="size-12 text-green-500 mx-auto" />
              <p className="text-sm font-medium">{t("oauthDialog.success")}</p>
              <p className="text-xs text-muted-foreground">{t("oauthDialog.successBody", { provider: providerName })}</p>
              {state.detailLines?.length ? (
                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-left text-xs text-muted-foreground">
                  {state.detailLines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ) : null}
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => onOpenChange(false)}
              >
                {t("common.close")}
              </Button>
            </div>
          )}

          {state.status === "error" && (
            <div className="text-center space-y-2">
              <XCircle className="size-12 text-destructive mx-auto" />
              <p className="text-sm font-medium">{t("oauthDialog.failed")}</p>
              <p className="text-xs text-muted-foreground">{state.error}</p>
              <div className="flex gap-2 justify-center mt-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={onStartFlow}>{t("common.tryAgain")}</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
