/**
 * DeviceFlowDialog — GitHub Device Flow authentication UI
 *
 * Shows the user_code and a link to github.com/login/device,
 * with live polling status updates.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DeviceFlowState } from "@/hooks";
import { useI18n } from "@/i18n";
import { openInBrowser } from "@/services/browser";
import { Copy, ExternalLink, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

interface DeviceFlowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: DeviceFlowState;
  onStartFlow: () => void;
}

export function DeviceFlowDialog({
  open,
  onOpenChange,
  state,
  onStartFlow,
}: DeviceFlowDialogProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || state.status !== "success") {
      return;
    }

    const timer = window.setTimeout(() => onOpenChange(false), 1000);
    return () => window.clearTimeout(timer);
  }, [open, onOpenChange, state.status]);

  const handleCopy = async () => {
    if (state.userCode) {
      await navigator.clipboard.writeText(state.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenGithub = async () => {
    if (state.verificationUri) {
      await openInBrowser(state.verificationUri);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("deviceDialog.title")}</DialogTitle>
          <DialogDescription>{t("deviceDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {state.status === "idle" && (
            <div className="text-center">
              <Button onClick={onStartFlow} className="w-full">
                {t("deviceDialog.start")}
              </Button>
            </div>
          )}

          {(state.status === "awaiting_code" || state.status === "polling") &&
            state.userCode && (
              <div className="space-y-4">
                {/* User code display */}
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-2">
                    {t("deviceDialog.enterCode")}
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <code className="text-3xl font-mono font-bold tracking-widest bg-muted px-4 py-2 rounded-lg">
                      {state.userCode}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleCopy}
                      title={t("deviceDialog.copyCode")}
                    >
                      {copied ? (
                        <CheckCircle2 className="size-4 text-green-500" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Open GitHub button */}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleOpenGithub}
                >
                  <ExternalLink className="size-4" />
                  {t("deviceDialog.openGithub")}
                </Button>

                {/* Polling status */}
                {state.status === "polling" && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span>
                      {t("deviceDialog.waiting")}
                      {state.pollAttempt
                        ? ` (${t("deviceDialog.attempt", { attempt: state.pollAttempt })})`
                        : "..."}
                    </span>
                  </div>
                )}
              </div>
            )}

          {state.status === "awaiting_code" && !state.userCode && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>{t("deviceDialog.requestingCode")}</span>
            </div>
          )}

          {state.status === "success" && (
            <div className="text-center space-y-2">
              <CheckCircle2 className="size-12 text-green-500 mx-auto" />
              <p className="text-sm font-medium">{t("deviceDialog.success")}</p>
              <p className="text-xs text-muted-foreground">{t("deviceDialog.successBody")}</p>
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
              <p className="text-sm font-medium">{t("deviceDialog.failed")}</p>
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
