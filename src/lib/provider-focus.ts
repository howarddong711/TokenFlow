import type { ProviderAccount, ProviderId } from "@/types";

// TokenFlow v1 is intentionally narrowed to the Quotio-aligned ecosystem.
// Providers outside this list stay in the codebase as backlog adapters, but
// they are hidden from the primary product surface until the Quotio parity
// set is finished.
export const FOCUSED_PROVIDER_IDS = [
  "codex",
  "claude",
  "qwen",
  "gemini",
  "iflow",
  "opencode",
  "copilot",
  "cursor",
  "trae",
  "antigravity",
  "kiro",
  "vertexai",
  "warp",
] as const satisfies readonly ProviderId[];

export const QUOTIO_PARITY_BACKLOG = ["glm"] as const;

const FOCUSED_PROVIDER_ID_SET = new Set<ProviderId>(FOCUSED_PROVIDER_IDS);
const FOCUSED_PROVIDER_ORDER = new Map<ProviderId, number>(
  FOCUSED_PROVIDER_IDS.map((providerId, index) => [providerId, index])
);

export function isFocusedProvider(providerId: ProviderId): boolean {
  return FOCUSED_PROVIDER_ID_SET.has(providerId);
}

export function getFocusedAccounts(accounts: ProviderAccount[]): ProviderAccount[] {
  return accounts.filter((account) => isFocusedProvider(account.providerId));
}

export function sortFocusedProviderIdsByUsage(
  providerIds: readonly ProviderId[],
  getTotalTokens: (providerId: ProviderId) => number
): ProviderId[] {
  return [...providerIds].sort((left, right) => {
    const tokenDelta = getTotalTokens(right) - getTotalTokens(left);
    if (tokenDelta !== 0) {
      return tokenDelta;
    }

    return (FOCUSED_PROVIDER_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (FOCUSED_PROVIDER_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER);
  });
}
