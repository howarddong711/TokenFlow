/**
 * Storage service — Persists provider accounts using Tauri Store plugin.
 *
 * Data is stored in `store.json` in the app's data directory.
 * NOTE: Tauri Store v2 saves plaintext JSON. For production, migrate
 * sensitive tokens to tauri-plugin-stronghold.
 */

import { load } from "@tauri-apps/plugin-store";
import type { ProviderAccount } from "@/types";

const STORE_FILE = "store.json";
const ACCOUNTS_KEY = "provider_accounts";

type StoredAccount = ProviderAccount;

async function getStore() {
  return await load(STORE_FILE, {
    defaults: { [ACCOUNTS_KEY]: [] },
    autoSave: true,
  });
}

function shouldPersist(account: ProviderAccount): boolean {
  return account.authStatus === "connected";
}

function normalizeStoredAccount(account: StoredAccount): ProviderAccount | null {
  if (!account.accountId) {
    return null;
  }


  return {
    ...account,
    authStatus: "connected",
  };
}

export async function saveAccounts(accounts: ProviderAccount[]): Promise<void> {
  const store = await getStore();
  const storedAccounts = accounts.filter(shouldPersist);
  await store.set(ACCOUNTS_KEY, storedAccounts);
}

export async function loadAccounts(): Promise<ProviderAccount[]> {
  try {
    const store = await getStore();
    const stored = await store.get<StoredAccount[]>(ACCOUNTS_KEY);
    if (!stored) {
      return [];
    }

    return stored
      .map(normalizeStoredAccount)
      .filter((account): account is ProviderAccount => account !== null);
  } catch (err) {
    console.error("[storage] Failed to load accounts:", err);
    return [];
  }
}

export async function clearAccount(accountId: string): Promise<void> {
  const store = await getStore();
  const stored = await store.get<StoredAccount[]>(ACCOUNTS_KEY);
  if (!stored) {
    return;
  }

  const filtered = stored.filter((account) => account.accountId !== accountId);
  await store.set(ACCOUNTS_KEY, filtered);
}

export async function clearAllAccounts(): Promise<void> {
  const store = await getStore();
  await store.delete(ACCOUNTS_KEY);
}
