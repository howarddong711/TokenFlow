/**
 * Copilot Auth Service
 *
 * TypeScript service layer that invokes Tauri Rust commands for
 * GitHub Copilot device flow authentication.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ProviderStatusResult } from "@/types";

export interface DeviceCodeResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface TokenPollResult {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface CopilotUserResult {
  login?: string;
  email?: string;
  name?: string;
  avatar_url?: string;
}

export interface CopilotStatusResult {
  plan: string;
  access_type_sku?: string;
  token_expires_at?: number;
  quotas: Array<{
    name: string;
    used: number;
    total: number;
    unlimited: boolean;
    resets_at?: string;
    unit: string;
  }>;
}

/**
 * Step 1: Start the GitHub device flow.
 * Returns a device code + user code for the user to enter at github.com/login/device.
 */
export async function startDeviceFlow(): Promise<DeviceCodeResult> {
  return invoke<DeviceCodeResult>("start_device_flow");
}

/**
 * Step 2: Poll GitHub for the access token.
 * Call this at `interval` seconds until you get an access_token or a terminal error.
 */
export async function pollDeviceFlow(
  deviceCode: string
): Promise<TokenPollResult> {
  return invoke<TokenPollResult>("poll_device_flow", {
    deviceCode,
  });
}

/**
 * Step 3: Fetch the authenticated user's GitHub profile.
 */
export async function getCopilotUser(
  accessToken: string
): Promise<CopilotUserResult> {
  return invoke<CopilotUserResult>("get_copilot_user", {
    accessToken,
  });
}

export async function getCopilotStatus(
  accessToken: string
): Promise<ProviderStatusResult> {
  const result = await invoke<CopilotStatusResult>("get_copilot_status", {
    accessToken,
  });

  return {
    plan: result.plan,
    access_type_sku: result.access_type_sku,
    token_expires_at: result.token_expires_at,
    quotas: result.quotas.map((quota) => ({
      name: quota.name,
      quota: {
        used: quota.used,
        total: quota.total,
        unlimited: quota.unlimited,
        resetsAt: quota.resets_at,
        unit: quota.unit,
      },
    })),
  };
}

/**
 * Run the full device flow polling loop.
 * Returns the access token on success.
 *
 * @param deviceCode - The device_code from startDeviceFlow
 * @param interval - Polling interval in seconds
 * @param expiresIn - Total timeout in seconds
 * @param onPoll - Optional callback on each poll attempt
 */
export async function pollUntilAuthorized(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onPoll?: (attempt: number, status: string) => void
): Promise<string> {
  const startTime = Date.now();
  const timeoutMs = expiresIn * 1000;
  let attempt = 0;
  let currentInterval = interval;

  while (Date.now() - startTime < timeoutMs) {
    // Wait for the polling interval
    await new Promise((resolve) =>
      setTimeout(resolve, currentInterval * 1000)
    );

    attempt++;
    onPoll?.(attempt, "polling");

    try {
      const result = await pollDeviceFlow(deviceCode);

      if (result.access_token) {
        return result.access_token;
      }

      if (result.error === "authorization_pending") {
        // User hasn't authorized yet, keep polling
        continue;
      }

      if (result.error === "slow_down") {
        // GitHub wants us to slow down — increase interval by 5 seconds
        currentInterval += 5;
        continue;
      }

      if (result.error === "expired_token") {
        throw new Error("Device code expired. Please try again.");
      }

      if (result.error === "access_denied") {
        throw new Error("Authorization was denied by the user.");
      }

      // Unknown error
      throw new Error(
        result.error_description ||
          result.error ||
          "Unknown error during device flow"
      );
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(String(err));
    }
  }

  throw new Error("Device flow timed out. Please try again.");
}
