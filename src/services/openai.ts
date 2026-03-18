import { invoke } from "@tauri-apps/api/core";
import { openInBrowser } from "@/services/browser";
import type { OpenAIPlan, ProviderStatusResult, QuotaCategory } from "@/types";

interface OpenAIStatusResult {
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

interface OpenAIOAuthStartResult {
  auth_url: string;
  state: string;
  code_verifier: string;
  port: number;
}

interface OpenAIOAuthCallbackResult {
  code: string;
}

interface OpenAIOAuthTokenResult {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  email?: string;
  plan: OpenAIPlan;
  account_id?: string;
}

export async function getOpenAIStatus(
  apiKey: string
): Promise<ProviderStatusResult & { username?: string }> {
  const result = await invoke<OpenAIStatusResult>("get_openai_status", {
    apiKey,
  });

  return {
    plan: result.plan,
    quotas: result.quotas.map((quota) => ({
      name: quota.name,
      quota: {
        used: quota.used,
        total: quota.total,
        unlimited: quota.unlimited,
        resetsAt: quota.resets_at,
        unit: quota.unit,
        displayMode: quota.total > 0 ? "progress" : "stat",
      },
    })),
    username: result.username,
  };
}

export function getOpenAIChatGPTQuotas(plan: OpenAIPlan): QuotaCategory[] {
  return [
    {
      name: "Codex access",
      quota: {
        used: 0,
        total: 0,
        unlimited: false,
        unit: "",
        displayMode: "stat",
        valueLabel: `${formatOpenAIPlan(plan)} plan`,
      },
    },
    {
      name: "Codex quota",
      quota: {
        used: 0,
        total: 0,
        unlimited: false,
        unit: "",
        displayMode: "stat",
        valueLabel: "Not exposed by OpenAI",
      },
    },
  ];
}

export function formatOpenAIPlan(plan: OpenAIPlan): string {
  switch (plan) {
    case "free":
      return "Free";
    case "go":
      return "Go";
    case "plus":
      return "Plus";
    case "pro":
      return "Pro";
    case "team":
      return "Team";
    case "business":
      return "Business";
    case "enterprise":
      return "Enterprise";
    case "edu":
      return "Edu";
  }
}

export async function startOpenAIChatGPTOAuth(): Promise<OpenAIOAuthStartResult> {
  return invoke<OpenAIOAuthStartResult>("start_openai_chatgpt_oauth");
}

export async function openAIWaitForCallback(
  state: string,
  port: number
): Promise<OpenAIOAuthCallbackResult> {
  return invoke<OpenAIOAuthCallbackResult>("openai_wait_for_callback", {
    state,
    port,
  });
}

export async function cancelOpenAIChatGPTOAuthWait(): Promise<void> {
  await invoke("cancel_openai_chatgpt_oauth_wait");
}

export async function openAIExchangeToken(
  code: string,
  codeVerifier: string,
  port: number
): Promise<OpenAIOAuthTokenResult> {
  return invoke<OpenAIOAuthTokenResult>("openai_exchange_chatgpt_token", {
    code,
    codeVerifier,
    port,
  });
}

export async function connectOpenAIChatGPTFull(onStatus?: (status: string) => void): Promise<{
  accessToken: string;
  refreshToken?: string;
  email?: string;
  plan: OpenAIPlan;
  accountId?: string;
  quotas: QuotaCategory[];
}> {
  onStatus?.("Generating authorization URL...");
  const oauthStart = await startOpenAIChatGPTOAuth();

  onStatus?.("Opening browser...");
  await openInBrowser(oauthStart.auth_url);

  onStatus?.("Waiting for authentication...");
  const callback = await openAIWaitForCallback(oauthStart.state, oauthStart.port);

  onStatus?.("Exchanging authorization code...");
  const tokens = await openAIExchangeToken(
    callback.code,
    oauthStart.code_verifier,
    oauthStart.port
  );

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    email: tokens.email,
    plan: tokens.plan,
    accountId: tokens.account_id,
    quotas: getOpenAIChatGPTQuotas(tokens.plan),
  };
}
