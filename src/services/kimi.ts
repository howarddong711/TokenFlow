import { invoke } from "@tauri-apps/api/core";
import type { ProviderStatusResult } from "@/types";

interface KimiStatusResult {
  plan: string;
  username?: string;
  quotas: Array<{
    name: string;
    used: number;
    total: number;
    unlimited: boolean;
    resets_at?: string;
    unit: string;
  }>;
}

export async function getKimiStatus(
  apiKey: string
): Promise<ProviderStatusResult & { username?: string }> {
  const result = await invoke<KimiStatusResult>("get_kimi_status", {
    apiKey,
  });

  return {
    plan: result.plan,
    username: result.username,
    quotas: result.quotas.map((quota) => ({
      name: quota.name,
      quota: {
        used: quota.used,
        total: quota.total,
        unlimited: quota.unlimited,
        resetsAt: quota.resets_at,
        unit: quota.unit,
        displayMode: "stat",
      },
    })),
  };
}
