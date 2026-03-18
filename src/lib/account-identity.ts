import type { ProviderAccount } from "@/types";

export type DuplicateMatchKind = "email" | "source";

export interface AccountDuplicateCluster {
  providerId: ProviderAccount["providerId"];
  matchKind: DuplicateMatchKind;
  value: string;
  displayValue: string;
  accounts: ProviderAccount[];
}

export interface AccountDuplicateMatch {
  account: ProviderAccount;
  matchKind: DuplicateMatchKind;
  displayValue: string;
}

interface IdentityEntry {
  key: string;
  displayValue: string;
  matchKind: DuplicateMatchKind;
}

export function getAccountDisplayLabel(account: ProviderAccount): string {
  return (
    account.alias ??
    account.email ??
    account.username ??
    account.browserLabel ??
    account.providerId
  );
}

export function findPotentialDuplicateAccounts(
  accounts: ProviderAccount[],
  input: {
    email?: string;
    browserLabel?: string;
  }
): AccountDuplicateMatch[] {
  const email = normalizeIdentityValue(input.email);
  const source = normalizeIdentityValue(input.browserLabel);
  const matches: AccountDuplicateMatch[] = [];
  const seen = new Set<string>();

  for (const account of accounts) {
    const identities = getIdentityEntries(account);
    const emailMatch = email
      ? identities.find((identity) => identity.matchKind === "email" && identity.key === email)
      : null;
    const sourceMatch = source
      ? identities.find((identity) => identity.matchKind === "source" && identity.key === source)
      : null;
    const matched = emailMatch ?? sourceMatch;
    if (!matched || seen.has(account.accountId)) {
      continue;
    }
    seen.add(account.accountId);
    matches.push({
      account,
      matchKind: matched.matchKind,
      displayValue: matched.displayValue,
    });
  }

  return matches.sort((left, right) =>
    getAccountDisplayLabel(left.account).localeCompare(getAccountDisplayLabel(right.account))
  );
}

export function findDuplicateAccountClusters(
  accounts: ProviderAccount[]
): AccountDuplicateCluster[] {
  const buckets = new Map<string, AccountDuplicateCluster>();

  for (const account of accounts) {
    if (account.accountId.startsWith("placeholder-")) {
      continue;
    }

    for (const identity of getIdentityEntries(account)) {
      const bucketKey = `${account.providerId}:${identity.matchKind}:${identity.key}`;
      const existing = buckets.get(bucketKey);
      if (existing) {
        existing.accounts.push(account);
        continue;
      }
      buckets.set(bucketKey, {
        providerId: account.providerId,
        matchKind: identity.matchKind,
        value: identity.key,
        displayValue: identity.displayValue,
        accounts: [account],
      });
    }
  }

  const deduped = new Map<string, AccountDuplicateCluster>();
  for (const cluster of buckets.values()) {
    if (cluster.accounts.length < 2) {
      continue;
    }
    const signature = cluster.accounts
      .map((account) => account.accountId)
      .sort()
      .join("|");
    const existing = deduped.get(signature);
    if (!existing || duplicateMatchPriority(cluster.matchKind) < duplicateMatchPriority(existing.matchKind)) {
      deduped.set(signature, {
        ...cluster,
        accounts: [...cluster.accounts].sort((left, right) =>
          getAccountDisplayLabel(left).localeCompare(getAccountDisplayLabel(right))
        ),
      });
    }
  }

  return [...deduped.values()].sort((left, right) => {
    if (left.accounts.length !== right.accounts.length) {
      return right.accounts.length - left.accounts.length;
    }
    return left.providerId.localeCompare(right.providerId);
  });
}

function getIdentityEntries(account: ProviderAccount): IdentityEntry[] {
  const identities: IdentityEntry[] = [];
  const email = normalizeIdentityValue(account.email);
  const source = normalizeIdentityValue(account.browserLabel);

  if (email) {
    identities.push({
      key: email,
      displayValue: account.email?.trim() || email,
      matchKind: "email",
    });
  }

  if (source) {
    identities.push({
      key: source,
      displayValue: account.browserLabel?.trim() || source,
      matchKind: "source",
    });
  }

  return identities;
}

function normalizeIdentityValue(value?: string): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function duplicateMatchPriority(kind: DuplicateMatchKind): number {
  switch (kind) {
    case "email":
      return 0;
    case "source":
    default:
      return 1;
  }
}
