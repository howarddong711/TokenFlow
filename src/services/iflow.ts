/**
 * iFlow Auth Service
 *
 * TypeScript service layer that invokes Tauri Rust commands for
 * iFlow OAuth authentication flow.
 */

import { invoke } from "@tauri-apps/api/core";
import { openInBrowser } from "@/services/browser";
import type { ProviderStatusResult } from "@/types";

export interface IflowOAuthStart {
  auth_url: string;
  state: string;
  port: number;
}

export interface IflowCallbackResult {
  code: string;
}

export interface IflowTokenResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface IflowUserInfo {
  email: string;
  api_key: string;
}

export interface IflowStatusResult {
  plan: string;
  username?: string;
  api_key: string;
  quotas: Array<{
    name: string;
    used: number;
    total: number;
    unlimited: boolean;
    resets_at?: string;
    unit: string;
  }>;
}

export interface IflowRefreshResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Step 1: Generate the OAuth authorization URL for iFlow.
 */
export async function startIflowOAuth(): Promise<IflowOAuthStart> {
  return invoke<IflowOAuthStart>("start_iflow_oauth");
}

/**
 * Step 2: Wait for the OAuth callback on the local server.
 * Blocks until the user completes auth in browser or timeout (5 min).
 */
export async function iflowWaitForCallback(
  state: string,
  port: number
): Promise<IflowCallbackResult> {
  return invoke<IflowCallbackResult>("iflow_wait_for_callback", {
    state,
    port,
  });
}

/**
 * Step 3: Exchange the authorization code for tokens.
 */
export async function iflowExchangeToken(
  code: string,
  port: number
): Promise<IflowTokenResult> {
  return invoke<IflowTokenResult>("iflow_exchange_token", {
    code,
    port,
  });
}

/**
 * Step 4: Fetch user info (email, API key) using the access token.
 */
export async function getIflowUserInfo(
  accessToken: string
): Promise<IflowUserInfo> {
  return invoke<IflowUserInfo>("get_iflow_user_info", {
    accessToken,
  });
}

/**
 * Fetch iFlow status (plan, API key, quota).
 */
export async function getIflowStatus(
  accessToken: string
): Promise<ProviderStatusResult & { username?: string }> {
  const result = await invoke<IflowStatusResult>("get_iflow_status", {
    accessToken,
  });

  return {
    plan: result.plan,
    username: result.username,
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
 * Refresh iFlow tokens using a refresh token.
 */
export async function iflowRefreshToken(
  refreshToken: string
): Promise<IflowRefreshResult> {
  return invoke<IflowRefreshResult>("iflow_refresh_token", {
    refreshToken,
  });
}

/**
 * Run the full iFlow OAuth flow.
 * Opens browser, waits for callback, exchanges code, fetches user info.
 *
 * @param onStatus - Callback for status updates
 * @returns Access token, refresh token, email, API key, and status
 */
export async function connectIflowFull(
  onStatus?: (status: string) => void
): Promise<{
  accessToken: string;
  refreshToken: string;
  email: string;
  apiKey: string;
  status: ProviderStatusResult;
}> {
  onStatus?.("Generating authorization URL...");
  const oauthStart = await startIflowOAuth();

  onStatus?.("Opening browser...");
  await openInBrowser(oauthStart.auth_url);

  onStatus?.("Waiting for authentication...");
  const callback = await iflowWaitForCallback(
    oauthStart.state,
    oauthStart.port
  );

  onStatus?.("Exchanging authorization code...");
  const tokens = await iflowExchangeToken(callback.code, oauthStart.port);

  onStatus?.("Fetching user info...");
  const userInfo = await getIflowUserInfo(tokens.access_token);

  onStatus?.("Fetching account status...");
  const status = await getIflowStatus(tokens.access_token);

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    email: userInfo.email,
    apiKey: userInfo.api_key,
    status,
  };
}
