/**
 * ApiKeyDialog — Generic API key entry dialog (kept for potential future use)
 *
 * NOTE: As of the monitoring-only rewrite, Dashboard no longer opens this dialog.
 * Quota data is fetched automatically without manual API key entry.
 * This file is preserved for reference / future extension.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { ProviderId } from "@/types";
import { PROVIDERS } from "@/types";
import { AlertCircle, KeyRound, Loader2 } from "lucide-react";

interface ApiKeyDialogProps {
  open: boolean;
  providerId: ProviderId | null;
  loading?: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (providerId: ProviderId, apiKey: string) => Promise<void>;
}

export function ApiKeyDialog({
  open,
  providerId,
  loading = false,
  error,
  onOpenChange,
  onSubmit,
}: ApiKeyDialogProps) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (!open) {
      setApiKey("");
    }
  }, [open]);

  const providerName = providerId
    ? PROVIDERS[providerId].name
    : t("apiDialog.defaultProvider");

  const handleSubmit = async () => {
    if (!providerId || !apiKey.trim()) return;
    await onSubmit(providerId, apiKey.trim());
  };

  const connectDisabled = !providerId || loading || !apiKey.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("apiDialog.connectTitle", { provider: providerName })}</DialogTitle>
          <DialogDescription>{t("apiDialog.helpDefault")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="provider-api-key">
              {t("apiDialog.apiKey")}
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="provider-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={t("apiDialog.apiKeyPlaceholder")}
                className="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/30"
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("apiDialog.apiKeyStored")}</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("apiDialog.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={connectDisabled}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("apiDialog.connect")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
