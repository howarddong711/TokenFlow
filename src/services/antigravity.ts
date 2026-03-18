/**
 * Anti-Gravity Auth Service
 *
 * TypeScript service layer that invokes Tauri Rust commands for
 * Anti-Gravity (Google OAuth) authentication flow.
 */

import { invoke } from "@tauri-apps/api/core";
import { openInBrowser } from "@/services/browser";
import type { ProviderStatusResult } from "@/types";

export interface AntigravityOAuthStart {
  auth_url: string;
  state: string;
  port: number;
}

export interface AntigravityCallbackResult {
  code: string;
}

export interface AntigravityTokenResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface AntigravityUserInfo {
  email: string;
}

export interface AntigravityStatusResult {
  plan: string;
  project_id?: string;
  quotas: Array<{
    name: string;
    used: number;
    total: number;
    unlimited: boolean;
    resets_at?: string;
    unit: string;
  }>;
}

export interface AntigravityRefreshResult {
  access_token: string;
  expires_in: number;
}

/**
 * Step 1: Generate the OAuth authorization URL for Anti-Gravity (Google).
 * Returns the URL the user should visit, plus the state and callback port.
 */
export async function startAntigravityOAuth(): Promise<AntigravityOAuthStart> {
  return invoke<AntigravityOAuthStart>("start_antigravity_oauth");
}

/**
 * Step 2: Wait for the OAuth callback on the local server.
 * Blocks until the user completes auth in browser or timeout (5 min).
 */
export async function antigravityWaitForCallback(
  state: string,
  port: number
): Promise<AntigravityCallbackResult> {
  return invoke<AntigravityCallbackResult>("antigravity_wait_for_callback", {
    state,
    port,
  });
}

/**
 * Step 3: Exchange the authorization code for tokens.
 */
export async function antigravityExchangeToken(
  code: string,
  port: number
): Promise<AntigravityTokenResult> {
  return invoke<AntigravityTokenResult>("antigravity_exchange_token", {
    code,
    port,
  });
}

/**
 * Step 4: Fetch user info (email) using the access token.
 */
export async function getAntigravityUserInfo(
  accessToken: string
): Promise<AntigravityUserInfo> {
  return invoke<AntigravityUserInfo>("get_antigravity_user_info", {
    accessToken,
  });
}

/**
 * Fetch Anti-Gravity status (project info, quota).
 */
export async function getAntigravityStatus(
  accessToken: string
): Promise<ProviderStatusResult> {
  const result = await invoke<AntigravityStatusResult>(
    "get_antigravity_status",
    { accessToken }
  );

  return {
    plan: result.plan,
    quotas: result.quotas.map((q) => ({
      name: q.name,
      quota: {
        used: q.used,
        total: q.total,
        unlimited: q.unlimited,
        resetsAt: q.resets_at,
        unit: q.unit,
      },
    })),
  };
}

/**
 * Refresh Anti-Gravity access token using a refresh token.
 */
export async function antigravityRefreshToken(
  refreshToken: string
): Promise<AntigravityRefreshResult> {
  return invoke<AntigravityRefreshResult>("antigravity_refresh_token", {
    refreshToken,
  });
}

/**
 * Run the full Anti-Gravity OAuth flow.
 * Opens browser, waits for callback, exchanges code, fetches user info.
 *
 * @param onStatus - Callback for status updates
 * @returns Access token, refresh token, email, and status
 */
export async function connectAntigravityFull(
  onStatus?: (status: string) => void
): Promise<{
  accessToken: string;
  refreshToken: string;
  email: string;
  status: ProviderStatusResult;
}> {
  onStatus?.("Generating authorization URL...");
  const oauthStart = await startAntigravityOAuth();

  onStatus?.("Opening browser...");
  await openInBrowser(oauthStart.auth_url);

  onStatus?.("Waiting for authentication...");
  const callback = await antigravityWaitForCallback(
    oauthStart.state,
    oauthStart.port
  );

  onStatus?.("Exchanging authorization code...");
  const tokens = await antigravityExchangeToken(callback.code, oauthStart.port);

  onStatus?.("Fetching user info...");
  const userInfo = await getAntigravityUserInfo(tokens.access_token);

  onStatus?.("Fetching account status...");
  const status = await getAntigravityStatus(tokens.access_token);

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    email: userInfo.email,
    status,
  };
}
