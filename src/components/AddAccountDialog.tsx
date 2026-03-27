import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  MonitorSmartphone,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeviceFlowDialog } from "@/components/DeviceFlowDialog";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  OAuthFlowDialog,
  type OAuthFlowState,
} from "@/components/OAuthFlowDialog";
import { useI18n } from "@/i18n";
import { getProductCopy } from "@/i18n/productCopy";
import { cn } from "@/lib/utils";
import {
  findPotentialDuplicateAccounts,
  getAccountDisplayLabel,
  type AccountDuplicateMatch,
  type DuplicateMatchKind,
} from "@/lib/account-identity";
import { getAccountUsageWindows } from "@/lib/monitoring";
import { openInBrowser } from "@/services/browser";
import type {
  AccountAuthKind,
  AccountSecretInput,
  ProviderAccount,
  ProviderCapabilityDto,
  ProviderId,
} from "@/types";
import { PROVIDERS } from "@/types";

interface AddAccountRequest {
  providerId: ProviderId;
  label?: string;
  authKind: AccountAuthKind;
  secret?: AccountSecretInput;
  display?: {
    username?: string;
    email?: string;
    avatar_url?: string;
    plan?: string;
    browser_label?: string;
  };
  default?: boolean;
}

interface DeviceFlowState {
  status: "idle" | "awaiting_code" | "polling" | "success" | "error";
  userCode?: string;
  verificationUri?: string;
  error?: string;
  pollAttempt?: number;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenPollResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface CopilotUserInfo {
  login?: string;
  email?: string;
  name?: string;
}

interface OpenAIOAuthStartResponse {
  auth_url: string;
  state: string;
  code_verifier: string;
  port: number;
}

interface OpenAICallbackResult {
  code: string;
}

interface OpenAIChatGPTTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  email?: string;
  plan: string;
  account_id?: string;
}

type InlineOpenAiFlowState = OAuthFlowState & {
  authUrl?: string;
};

interface ClaudeOAuthStartResponse {
  previous_fingerprint?: string;
  status_text: string;
}

interface ClaudeOAuthPollResponse {
  completed: boolean;
  fingerprint?: string;
  credentials?: {
    access_token: string;
    refresh_token?: string;
    expires_at?: string;
    scopes: string[];
    rate_limit_tier?: string;
  };
}

interface GeminiCliOAuthImportResponse {
  credentials: {
    access_token: string;
    refresh_token?: string;
    expires_at?: string;
    scopes: string[];
    rate_limit_tier?: string;
  };
  email?: string;
}

interface QwenCliOAuthImportResponse {
  credentials: {
    access_token: string;
    refresh_token?: string;
    expires_at?: string;
    scopes: string[];
    rate_limit_tier?: string;
  };
  email?: string;
  resource_url?: string;
}

interface QwenCliOAuthCandidate {
  file_path: string;
  file_name: string;
  email?: string;
  resource_url?: string;
  expired?: string;
  disabled: boolean;
  last_modified?: string;
}

interface IflowOAuthStartResponse {
  auth_url: string;
  state: string;
  port: number;
}

interface IflowCallbackResult {
  code: string;
}

interface IflowTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface IflowUserInfoResponse {
  email: string;
  api_key: string;
}

interface AntigravityOAuthStartResponse {
  auth_url: string;
  state: string;
  port: number;
}

interface AntigravityOAuthAvailabilityResponse {
  configured: boolean;
  missing: string[];
}

interface AntigravityCallbackResult {
  code: string;
}

interface AntigravityTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface AntigravityUserInfoResponse {
  email: string;
}

interface CursorBrowserProfileCandidate {
  browser_label: string;
  email?: string;
  plan?: string;
}

interface CursorBrowserProfileImport {
  browser_label: string;
  cookie_header: string;
  email?: string;
  plan?: string;
}

interface CursorLocalSessionImport {
  email?: string;
  plan?: string;
}

interface TraeLocalSessionImport {
  email?: string;
  username?: string;
  plan?: string;
}

interface VertexServiceAccountCredentials {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface VertexServiceAccountValidationResponse {
  project_id: string;
  client_email: string;
  plan: string;
}

interface AddAccountDialogProps {
  open: boolean;
  providerId: ProviderId | null;
  capability?: ProviderCapabilityDto;
  existingAccounts: ProviderAccount[];
  onOpenChange: (open: boolean) => void;
  onAddAccount: (input: AddAccountRequest) => Promise<ProviderAccount>;
}

interface ConnectionPreset {
  visibleAuthKinds: AccountAuthKind[];
  defaultAuthKind: AccountAuthKind;
  title: string;
  summary: string;
  mode:
    | "oauth"
    | "device"
    | "cookie_scan"
    | "cookie_manual"
    | "api_key"
    | "file_import"
    | "system";
}

const CONNECTION_PRESETS: Record<ProviderId, ConnectionPreset> = {
  codex: {
    visibleAuthKinds: ["oauth_token"],
    defaultAuthKind: "oauth_token",
    title: "Connect with your real OpenAI account",
    summary:
      "Use the official OpenAI browser sign-in so TokenFlow can monitor the same Codex or ChatGPT plan you actually use.",
    mode: "oauth",
  },
  claude: {
    visibleAuthKinds: ["oauth_token", "imported_cli_oauth"],
    defaultAuthKind: "oauth_token",
    title: "Connect Claude the way you already work",
    summary:
      "Recommended: launch the official Claude login flow. Advanced users can also paste imported CLI OAuth credentials.",
    mode: "oauth",
  },
  qwen: {
    visibleAuthKinds: ["imported_cli_oauth"],
    defaultAuthKind: "imported_cli_oauth",
    title: "Import the Qwen OAuth account already stored on this machine",
    summary:
      "Closest to Quotio for now: TokenFlow imports an existing local Qwen OAuth file instead of pretending a generic web callback flow exists here.",
    mode: "oauth",
  },
  copilot: {
    visibleAuthKinds: ["oauth_token"],
    defaultAuthKind: "oauth_token",
    title: "Authorize with GitHub device flow",
    summary:
      "TokenFlow opens the standard GitHub device authorization flow and stores the resulting account as a separate monitored seat.",
    mode: "device",
  },
  gemini: {
    visibleAuthKinds: ["imported_cli_oauth"],
    defaultAuthKind: "imported_cli_oauth",
    title: "Import the account you already signed into Gemini CLI",
    summary:
      "Import the Gemini CLI OAuth credentials already stored on this machine and sync live model quota windows from Google.",
    mode: "oauth",
  },
  iflow: {
    visibleAuthKinds: ["oauth_token"],
    defaultAuthKind: "oauth_token",
    title: "Connect iFlow with the official browser sign-in",
    summary:
      "TokenFlow opens the official iFlow authorization page, waits for the callback, and stores the linked account as a monitored OAuth seat.",
    mode: "oauth",
  },
  cursor: {
    visibleAuthKinds: ["local_detected", "browser_profile_cookie", "manual_cookie"],
    defaultAuthKind: "local_detected",
    title: "Scan your browser profiles for Cursor sessions",
    summary:
      "TokenFlow can import separate browser profiles as independent Cursor accounts, which is the best path for multi-account monitoring.",
    mode: "cookie_scan",
  },
  trae: {
    visibleAuthKinds: ["local_detected"],
    defaultAuthKind: "local_detected",
    title: "Attach to the Trae session already signed into this machine",
    summary:
      "Quotio treats Trae as monitor-only. TokenFlow reads the local desktop session and keeps the provider's quota windows in their native shape.",
    mode: "oauth",
  },
  factory: {
    visibleAuthKinds: ["manual_cookie"],
    defaultAuthKind: "manual_cookie",
    title: "Paste the session cookie used by Windsurf or Factory",
    summary:
      "This provider is monitored from a web session today, so the connection path is a cookie-based account import.",
    mode: "cookie_manual",
  },
  kimi: {
    visibleAuthKinds: ["manual_cookie"],
    defaultAuthKind: "manual_cookie",
    title: "Paste the session cookie used by Kimi",
    summary: "Kimi account monitoring currently uses a web session import.",
    mode: "cookie_manual",
  },
  ollama: {
    visibleAuthKinds: ["manual_cookie"],
    defaultAuthKind: "manual_cookie",
    title: "Paste the session cookie used by Ollama web",
    summary: "This provider path currently monitors a session-based account.",
    mode: "cookie_manual",
  },
  opencode: {
    visibleAuthKinds: ["manual_cookie"],
    defaultAuthKind: "manual_cookie",
    title: "Paste the session cookie used by OpenCode",
    summary: "This provider path currently monitors a session-based account.",
    mode: "cookie_manual",
  },
  openrouter: {
    visibleAuthKinds: ["api_key"],
    defaultAuthKind: "api_key",
    title: "Connect with an API key",
    summary:
      "Use a dedicated API key so TokenFlow can monitor budget and quota signals for this provider.",
    mode: "api_key",
  },
  warp: {
    visibleAuthKinds: ["api_key"],
    defaultAuthKind: "api_key",
    title: "Connect with an API key",
    summary: "Use the account-level API credential you want TokenFlow to monitor.",
    mode: "api_key",
  },
  zai: {
    visibleAuthKinds: ["api_key"],
    defaultAuthKind: "api_key",
    title: "Connect with an API key",
    summary: "Use a dedicated API key so TokenFlow can monitor this account independently.",
    mode: "api_key",
  },
  minimax: {
    visibleAuthKinds: ["api_key"],
    defaultAuthKind: "api_key",
    title: "Connect with an API key",
    summary: "Use a dedicated API key so TokenFlow can monitor this account independently.",
    mode: "api_key",
  },
  vertexai: {
    visibleAuthKinds: ["service_account_json"],
    defaultAuthKind: "service_account_json",
    title: "Import a Vertex AI service account JSON",
    summary:
      "Bring in a Google Cloud service account file so TokenFlow can validate and monitor the linked Vertex AI project.",
    mode: "file_import",
  },
  augment: {
    visibleAuthKinds: ["api_key"],
    defaultAuthKind: "api_key",
    title: "Connect with an API key",
    summary: "Use a dedicated API key so TokenFlow can monitor this account independently.",
    mode: "api_key",
  },
  amp: {
    visibleAuthKinds: ["api_key"],
    defaultAuthKind: "api_key",
    title: "Connect with an API key",
    summary: "Use a dedicated API key so TokenFlow can monitor this account independently.",
    mode: "api_key",
  },
  kimik2: {
    visibleAuthKinds: ["api_key"],
    defaultAuthKind: "api_key",
    title: "Connect with an API key",
    summary: "Use a dedicated API key so TokenFlow can monitor this account independently.",
    mode: "api_key",
  },
  synthetic: {
    visibleAuthKinds: ["api_key"],
    defaultAuthKind: "api_key",
    title: "Connect with an API key",
    summary: "Use a dedicated API key so TokenFlow can monitor this account independently.",
    mode: "api_key",
  },
  antigravity: {
    visibleAuthKinds: ["oauth_token"],
    defaultAuthKind: "oauth_token",
    title: "Connect Anti-Gravity with the official Google sign-in",
    summary:
      "TokenFlow opens the same Google authorization path Anti-Gravity relies on, then stores the account as a monitored OAuth seat.",
    mode: "oauth",
  },
  kiro: {
    visibleAuthKinds: ["local_detected"],
    defaultAuthKind: "local_detected",
    title: "Use the Kiro session already signed into this machine",
    summary:
      "Quotio-style Kiro support is closer to local CLI or desktop session monitoring than a browser callback. TokenFlow can attach a monitor to the local Kiro environment.",
    mode: "oauth",
  },
  jetbrains: {
    visibleAuthKinds: [],
    defaultAuthKind: "oauth_token",
    title: "This provider is managed automatically",
    summary: "Manual account creation is disabled for this provider in the current runtime.",
    mode: "system",
  },
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function parseVertexServiceAccountJson(raw: string): VertexServiceAccountCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON file.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Service account JSON is malformed.");
  }

  const record = parsed as Record<string, unknown>;
  const projectId = typeof record.project_id === "string" ? record.project_id.trim() : "";
  const clientEmail = typeof record.client_email === "string" ? record.client_email.trim() : "";
  const privateKey = typeof record.private_key === "string" ? record.private_key : "";
  const tokenUri =
    typeof record.token_uri === "string" && record.token_uri.trim().length > 0
      ? record.token_uri.trim()
      : "https://oauth2.googleapis.com/token";

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Service account JSON must include project_id, client_email, and private_key.");
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: tokenUri,
  };
}

function buildAccountSummaryLines(
  copy: ReturnType<typeof getProductCopy>["addAccount"],
  account: ProviderAccount
): string[] {
  const lines: string[] = [];
  if (account.alias) lines.push(`${copy.summaryLines.account}: ${account.alias}`);
  if (account.email) lines.push(`${copy.summaryLines.email}: ${account.email}`);
  if (account.subscription?.plan) lines.push(`${copy.summaryLines.plan}: ${account.subscription.plan}`);
  const usageWindows = getAccountUsageWindows(account);
  if (usageWindows.length > 0) {
    lines.push(`${copy.summaryLines.quotaWindows}: ${usageWindows.length}`);
  }
  return lines;
}

function getLocalizedPreset(
  providerId: ProviderId,
  copy: ReturnType<typeof getProductCopy>["addAccount"]
) {
  switch (providerId) {
    case "codex":
      return copy.presets.codex;
    case "claude":
      return copy.presets.claude;
    case "qwen":
      return copy.presets.qwen;
    case "copilot":
      return copy.presets.copilot;
    case "gemini":
      return copy.presets.gemini;
    case "iflow":
      return copy.presets.iflow;
    case "cursor":
      return copy.presets.cursor;
    case "trae":
      return copy.presets.trae;
    case "factory":
      return copy.presets.factory;
    case "kimi":
      return copy.presets.kimi;
    case "ollama":
      return copy.presets.ollama;
    case "opencode":
      return copy.presets.opencode;
    case "openrouter":
      return copy.presets.apiKey;
    case "warp":
      return { ...copy.presets.apiKey, summary: copy.presets.apiKeySimpleSummary };
    case "zai":
    case "minimax":
    case "augment":
    case "amp":
    case "kimik2":
    case "synthetic":
      return { ...copy.presets.apiKey, summary: copy.presets.apiKeyIndependentSummary };
    case "vertexai":
      return copy.presets.vertexai;
    case "antigravity":
      return copy.presets.antigravity;
    case "kiro":
      return copy.presets.kiro;
    case "jetbrains":
      return {
        title: copy.presets.systemTitle,
        summary: copy.presets.systemSummary,
      };
    default:
      return null;
  }
}

function getAuthKindsForProvider(
  providerId: ProviderId | null,
  capability?: ProviderCapabilityDto
): AccountAuthKind[] {
  if (!providerId) return [];
  const preset = CONNECTION_PRESETS[providerId];
  if (!capability?.auth_kinds?.length) return preset.visibleAuthKinds;
  const capabilitySet = new Set(capability.auth_kinds);
  return preset.visibleAuthKinds.filter((kind) => capabilitySet.has(kind));
}

function describeDuplicateMatch(
  copy: ReturnType<typeof getProductCopy>["addAccount"],
  matchKind: DuplicateMatchKind
) {
  return matchKind === "email" ? copy.shared.duplicateEmail : copy.shared.duplicateSource;
}

function joinDuplicateLabels(matches: AccountDuplicateMatch[]) {
  return matches.map((match) => getAccountDisplayLabel(match.account)).join(" · ");
}

function joinAccountLabels(accounts: ProviderAccount[]) {
  return accounts.map((account) => getAccountDisplayLabel(account)).join(" · ");
}

export function AddAccountDialog({
  open,
  providerId,
  capability,
  existingAccounts,
  onOpenChange,
  onAddAccount,
}: AddAccountDialogProps) {
  const { lang } = useI18n();
  const copy = getProductCopy(lang).addAccount;
  const provider = providerId ? PROVIDERS[providerId] : null;
  const preset = providerId ? CONNECTION_PRESETS[providerId] : null;
  const presetText = providerId ? getLocalizedPreset(providerId, copy) : null;
  const providerName = provider?.name ?? copy.providerFallback;
  const supportedAuthKinds = useMemo(
    () => getAuthKindsForProvider(providerId, capability),
    [capability, providerId]
  );
  const providerExistingAccounts = useMemo(
    () =>
      providerId
        ? existingAccounts.filter(
            (account) =>
              account.providerId === providerId && !account.accountId.startsWith("placeholder-")
          )
        : [],
    [existingAccounts, providerId]
  );
  const existingLocalSessionAccounts = useMemo(
    () =>
      providerExistingAccounts.filter((account) => account.accountAuthKind === "local_detected"),
    [providerExistingAccounts]
  );

  const [label, setLabel] = useState("");
  const [authKind, setAuthKind] = useState<AccountAuthKind>("api_key");
  const [secretValue, setSecretValue] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursorProfiles, setCursorProfiles] = useState<CursorBrowserProfileCandidate[]>([]);
  const [cursorProfilesLoading, setCursorProfilesLoading] = useState(false);
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowState>({ status: "idle" });
  const [oauthDialogOpen, setOAuthDialogOpen] = useState(false);
  const [oauthState, setOAuthState] = useState<InlineOpenAiFlowState>({ status: "idle" });
  const [openAiAuthStart, setOpenAiAuthStart] = useState<OpenAIOAuthStartResponse | null>(null);
  const [openAiCallbackUrl, setOpenAiCallbackUrl] = useState("");
  const [openAiLinkCopied, setOpenAiLinkCopied] = useState(false);
  const [vertexServiceAccountText, setVertexServiceAccountText] = useState("");
  const [vertexServiceAccountFileName, setVertexServiceAccountFileName] = useState("");
  const [qwenCandidates, setQwenCandidates] = useState<QwenCliOAuthCandidate[]>([]);
  const [qwenCandidatesLoading, setQwenCandidatesLoading] = useState(false);
  const vertexFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setLabel("");
      setSecretValue("");
      setRefreshToken("");
      setExpiresAt("");
      setSetAsDefault(false);
      setError(null);
      setCursorProfiles([]);
      setCursorProfilesLoading(false);
      setDeviceDialogOpen(false);
      setDeviceFlow({ status: "idle" });
      setOAuthDialogOpen(false);
      setOAuthState({ status: "idle" });
      setOpenAiAuthStart(null);
      setOpenAiCallbackUrl("");
      setOpenAiLinkCopied(false);
      setVertexServiceAccountText("");
      setVertexServiceAccountFileName("");
      setQwenCandidates([]);
      setQwenCandidatesLoading(false);
      return;
    }

    setAuthKind(supportedAuthKinds[0] ?? preset?.defaultAuthKind ?? "api_key");
  }, [open, preset?.defaultAuthKind, supportedAuthKinds]);

  useEffect(() => {
    if (!open || providerId !== "codex" || oauthState.status !== "success") {
      return;
    }

    const timer = window.setTimeout(() => onOpenChange(false), 1000);
    return () => window.clearTimeout(timer);
  }, [oauthState.status, onOpenChange, open, providerId]);

  const canSubmitManual =
    !loading &&
    !!providerId &&
    ((authKind === "api_key" || authKind === "manual_cookie")
      ? secretValue.trim().length > 0
      : authKind === "oauth_token" || authKind === "imported_cli_oauth"
        ? secretValue.trim().length > 0
        : false);
  const canSubmitVertexServiceAccount =
    !loading && !!providerId && vertexServiceAccountText.trim().length > 0;
  const vertexServiceAccountPreview = useMemo(() => {
    if (!vertexServiceAccountText.trim()) {
      return null;
    }

    try {
      return parseVertexServiceAccountJson(vertexServiceAccountText);
    } catch {
      return null;
    }
  }, [vertexServiceAccountText]);
  const cursorProfileMatches = useMemo(
    () =>
      Object.fromEntries(
        cursorProfiles.map((profile) => [
          profile.browser_label,
          findPotentialDuplicateAccounts(providerExistingAccounts, {
            email: profile.email,
            browserLabel: profile.browser_label,
          }),
        ])
      ) as Record<string, AccountDuplicateMatch[]>,
    [cursorProfiles, providerExistingAccounts]
  );
  const qwenCandidateMatches = useMemo(
    () =>
      Object.fromEntries(
        qwenCandidates.map((candidate) => [
          candidate.file_path,
          findPotentialDuplicateAccounts(providerExistingAccounts, {
            email: candidate.email,
            browserLabel: candidate.resource_url,
          }),
        ])
      ) as Record<string, AccountDuplicateMatch[]>,
    [providerExistingAccounts, qwenCandidates]
  );

  const submitManualAccount = async () => {
    if (!providerId) return;
    setLoading(true);
    setError(null);
    try {
      const input: AddAccountRequest = {
        providerId,
        label: label.trim() || undefined,
        authKind,
        display: {},
        default: setAsDefault,
      };

      if (authKind === "api_key") {
        input.secret = { kind: "api_key", value: secretValue.trim() };
      } else if (authKind === "service_account_json") {
        input.secret = {
          kind: "service_account_json",
          credentials: parseVertexServiceAccountJson(secretValue.trim()),
        };
      } else if (authKind === "manual_cookie") {
        input.secret = { kind: "manual_cookie", cookie_header: secretValue.trim() };
      } else if (authKind === "oauth_token") {
        input.secret = {
          kind: "oauth",
          credentials: {
            access_token: secretValue.trim(),
            refresh_token: refreshToken.trim() || undefined,
            expires_at: expiresAt.trim() || undefined,
            scopes: [],
          },
        };
      } else if (authKind === "imported_cli_oauth") {
        input.secret = {
          kind: "imported_cli_oauth",
          credentials: {
            access_token: secretValue.trim(),
            refresh_token: refreshToken.trim() || undefined,
            expires_at: expiresAt.trim() || undefined,
            scopes: [],
          },
        };
      }

      await onAddAccount(input);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadCursorBrowserProfiles = async () => {
    setCursorProfilesLoading(true);
    setError(null);
    try {
      const profiles = await invoke<CursorBrowserProfileCandidate[]>("list_cursor_browser_profiles");
      setCursorProfiles(profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCursorProfilesLoading(false);
    }
  };

  const createCursorAccount = async (imported: CursorBrowserProfileImport) => {
    if (!providerId) {
      throw new Error(copy.providerFallback);
    }

    return onAddAccount({
      providerId,
      label: label.trim() || imported.email || imported.browser_label,
      authKind: "browser_profile_cookie",
      secret: {
        kind: "browser_profile_cookie",
        browser_label: imported.browser_label,
        cookie_header: imported.cookie_header,
      },
      display: {
        email: imported.email,
        plan: imported.plan,
        browser_label: imported.browser_label,
      },
      default: setAsDefault,
    });
  };

  const createTraeAccount = async (detected: TraeLocalSessionImport) => {
    if (!providerId) {
      throw new Error(copy.providerFallback);
    }

    return onAddAccount({
      providerId,
      label:
        label.trim() ||
        detected.email ||
        detected.username ||
        `${providerName} Desktop`,
      authKind: "local_detected",
      display: {
        email: detected.email,
        username: detected.username,
        plan: detected.plan,
        browser_label: "Trae/Desktop",
      },
      default: setAsDefault,
    });
  };

  const importCursorLocalSession = async () => {
    if (!providerId) return;
    setLoading(true);
    setError(null);
    try {
      const detected = await invoke<CursorLocalSessionImport>("import_cursor_local_session");
      const created = await onAddAccount({
        providerId,
        label: label.trim() || detected.email || `${providerName} Desktop`,
        authKind: "local_detected",
        display: {
          email: detected.email,
          plan: detected.plan,
          browser_label: "Cursor/Desktop",
        },
        default: setAsDefault,
      });

      setOAuthDialogOpen(true);
      setOAuthState({
        status: "success",
        statusText: copy.presets.cursor.localSessionSuccess,
        detailLines: buildAccountSummaryLines(copy, created),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const importTraeLocalSession = async () => {
    if (!providerId) return;
    setLoading(true);
    setError(null);
    try {
      const detected = await invoke<TraeLocalSessionImport>("import_trae_local_session");
      const created = await createTraeAccount(detected);

      setOAuthDialogOpen(true);
      setOAuthState({
        status: "success",
        statusText: copy.presets.trae.success,
        detailLines: buildAccountSummaryLines(copy, created),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const startTraeBrowserLogin = async () => {
    if (!providerId) return;

    setError(null);
    setOAuthDialogOpen(true);
    setOAuthState({
      status: "starting",
      statusText: copy.presets.trae.browserLoginPreparing,
    });

    let existingFingerprint: string | null = null;
    try {
      const existing = await invoke<TraeLocalSessionImport>("import_trae_local_session");
      existingFingerprint = [
        existing.email?.trim().toLowerCase() || "",
        existing.username?.trim().toLowerCase() || "",
      ].join("|");
    } catch {
      existingFingerprint = null;
    }

    try {
      await openInBrowser("https://www.trae.ai/login");

      setOAuthState({
        status: "waiting",
        statusText: copy.presets.trae.browserLoginWaiting,
      });

      for (let attempt = 0; attempt < 90; attempt += 1) {
        await sleep(2000);

        try {
          const detected = await invoke<TraeLocalSessionImport>("import_trae_local_session");
          const nextFingerprint = [
            detected.email?.trim().toLowerCase() || "",
            detected.username?.trim().toLowerCase() || "",
          ].join("|");

          if (existingFingerprint && nextFingerprint === existingFingerprint) {
            continue;
          }

          const created = await createTraeAccount(detected);
          setOAuthState({
            status: "success",
            statusText: copy.presets.trae.success,
            detailLines: buildAccountSummaryLines(copy, created),
          });
          return;
        } catch {
          continue;
        }
      }

      throw new Error(copy.presets.trae.browserLoginTimeout);
    } catch (err) {
      setOAuthState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const startCursorBrowserLogin = async () => {
    if (!providerId) return;

    setError(null);
    setOAuthDialogOpen(true);
    setOAuthState({
      status: "starting",
      statusText: copy.presets.cursor.browserLoginPreparing,
    });

    try {
      const existingProfiles = await invoke<CursorBrowserProfileCandidate[]>(
        "list_cursor_browser_profiles"
      );
      const existingLabels = new Set(
        existingProfiles.map((profile) => profile.browser_label.trim().toLowerCase())
      );
      setCursorProfiles(existingProfiles);

      await openInBrowser("https://cursor.com/settings");

      setOAuthState({
        status: "waiting",
        statusText: copy.presets.cursor.browserLoginWaiting,
      });

      for (let attempt = 0; attempt < 60; attempt += 1) {
        await sleep(2000);

        const nextProfiles = await invoke<CursorBrowserProfileCandidate[]>(
          "list_cursor_browser_profiles"
        );
        setCursorProfiles(nextProfiles);

        const newProfiles = nextProfiles.filter(
          (profile) => !existingLabels.has(profile.browser_label.trim().toLowerCase())
        );

        if (newProfiles.length > 1 || (existingProfiles.length === 0 && nextProfiles.length > 1)) {
          throw new Error(copy.presets.cursor.browserLoginMultiple);
        }

        const detectedProfile =
          newProfiles[0] ??
          (existingProfiles.length === 0 && nextProfiles.length === 1 ? nextProfiles[0] : undefined);

        if (!detectedProfile) {
          continue;
        }

        const imported = await invoke<CursorBrowserProfileImport>(
          "import_cursor_browser_profile",
          {
            browserLabel: detectedProfile.browser_label,
          }
        );
        const created = await createCursorAccount(imported);

        setOAuthState({
          status: "success",
          statusText: copy.browserImportSuccess,
          detailLines: buildAccountSummaryLines(copy, created),
        });
        return;
      }

      throw new Error(copy.presets.cursor.browserLoginTimeout);
    } catch (err) {
      setOAuthState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const importCursorBrowserProfile = async (browserLabel: string) => {
    if (!providerId) return;
    setLoading(true);
    setError(null);
    try {
      const imported = await invoke<CursorBrowserProfileImport>("import_cursor_browser_profile", {
        browserLabel,
      });
      const created = await createCursorAccount(imported);

      setOAuthDialogOpen(true);
      setOAuthState({
        status: "success",
        statusText: copy.browserImportSuccess,
        detailLines: buildAccountSummaryLines(copy, created),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const startCopilotDeviceFlow = async () => {
    if (!providerId) return;

    setDeviceDialogOpen(true);
    setDeviceFlow({ status: "awaiting_code" });

    try {
      const start = await invoke<DeviceCodeResponse>("start_device_flow");
      setDeviceFlow({
        status: "polling",
        userCode: start.user_code,
        verificationUri: start.verification_uri,
        pollAttempt: 0,
      });

      await openInBrowser(start.verification_uri);

      let intervalMs = Math.max(start.interval, 1) * 1000;
      let attempts = 0;

      while (attempts * intervalMs < start.expires_in * 1000) {
        attempts += 1;
        await sleep(intervalMs);
        setDeviceFlow((prev) => ({ ...prev, status: "polling", pollAttempt: attempts }));

        const poll = await invoke<TokenPollResponse>("poll_device_flow", {
          deviceCode: start.device_code,
        });

        if (poll.access_token) {
          const user = await invoke<CopilotUserInfo>("get_copilot_user", {
            accessToken: poll.access_token,
          });

          await onAddAccount({
            providerId,
            label: label.trim() || user.email || user.login || undefined,
            authKind: "oauth_token",
            secret: {
              kind: "oauth",
              credentials: {
                access_token: poll.access_token,
                scopes: ["read:user", "user:email"],
              },
            },
            display: {
              username: user.login,
              email: user.email,
              plan: "GitHub OAuth",
            },
            default: setAsDefault,
          });

          setDeviceFlow({ status: "success" });
          return;
        }

        if (poll.error === "slow_down") {
          intervalMs += 5000;
          continue;
        }

        if (poll.error && poll.error !== "authorization_pending") {
          throw new Error(poll.error_description || poll.error);
        }
      }

      throw new Error(copy.githubTimeout);
    } catch (err) {
      setDeviceFlow({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const startCodexOauth = async () => {
    if (!providerId) return;

    setOpenAiCallbackUrl("");
    setOpenAiLinkCopied(false);
    setOAuthState({
      status: "starting",
      statusText: copy.openAiPreparing,
    });

    try {
      const start = await invoke<OpenAIOAuthStartResponse>("start_openai_chatgpt_oauth");
      setOpenAiAuthStart(start);
      await openInBrowser(start.auth_url);

      setOAuthState({
        status: "waiting",
        statusText: copy.openAiWaiting,
        authUrl: start.auth_url,
      });

      void waitForCodexCallback(start);
    } catch (err) {
      setOAuthState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const completeCodexOauth = async (
    start: OpenAIOAuthStartResponse,
    code: string
  ) => {
    if (!providerId) return;

    setOAuthState({
      status: "exchanging",
      statusText: copy.openAiExchanging,
      authUrl: start.auth_url,
    });

    const tokens = await invoke<OpenAIChatGPTTokenResponse>(
      "openai_exchange_chatgpt_token",
      {
        code,
        codeVerifier: start.code_verifier,
        port: start.port,
      }
    );

    const expiresAtIso = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const created = await onAddAccount({
      providerId,
      label: label.trim() || tokens.email || undefined,
      authKind: "oauth_token",
      secret: {
        kind: "oauth",
        credentials: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAtIso,
          scopes: ["openid", "email", "profile", "offline_access"],
          rate_limit_tier: tokens.plan,
        },
      },
      display: {
        email: tokens.email,
        plan: tokens.plan,
      },
      default: setAsDefault,
    });

    setOAuthState({
      status: "success",
      statusText: copy.openAiSuccess,
      detailLines: buildAccountSummaryLines(copy, created),
      authUrl: start.auth_url,
    });
  };

  const waitForCodexCallback = async (start: OpenAIOAuthStartResponse) => {
    try {
      const callback = await invoke<OpenAICallbackResult>("openai_wait_for_callback", {
        state: start.state,
        port: start.port,
      });
      await completeCodexOauth(start, callback.code);
    } catch (err) {
      setOAuthState({
        status: "waiting",
        statusText: copy.openAiWaiting,
        error: err instanceof Error ? err.message : String(err),
        authUrl: start.auth_url,
      });
    }
  };

  const verifyOpenAiCallbackUrl = async () => {
    if (!openAiAuthStart) return;

    try {
      const parsed = new URL(openAiCallbackUrl.trim());
      const code = parsed.searchParams.get("code");
      const state = parsed.searchParams.get("state");

      if (!code) {
        throw new Error(lang === "zh" ? "回调链接里缺少 code 参数。" : "Callback URL is missing the code parameter.");
      }

      if (state && state !== openAiAuthStart.state) {
        throw new Error(lang === "zh" ? "回调链接 state 不匹配。" : "Callback URL state does not match.");
      }

      await completeCodexOauth(openAiAuthStart, code);
    } catch (err) {
      setOAuthState((current) => ({
        ...current,
        status: "waiting",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const copyOpenAiLink = async () => {
    if (!oauthState.authUrl) return;
    await navigator.clipboard.writeText(oauthState.authUrl);
    setOpenAiLinkCopied(true);
    window.setTimeout(() => setOpenAiLinkCopied(false), 1200);
  };

  const startClaudeOauth = async () => {
    if (!providerId) return;

    setOAuthDialogOpen(true);
    setOAuthState({
      status: "starting",
      statusText: copy.claudePreparing,
    });

    try {
      const start = await invoke<ClaudeOAuthStartResponse>("start_claude_oauth_login");
      setOAuthState({
        status: "waiting",
        statusText: start.status_text || copy.claudeWaiting,
      });

      for (let attempt = 0; attempt < 120; attempt += 1) {
        await sleep(2000);
        const poll = await invoke<ClaudeOAuthPollResponse>("poll_claude_oauth_login", {
          previousFingerprint: start.previous_fingerprint,
        });

        if (!poll.completed || !poll.credentials) {
          continue;
        }

        const created = await onAddAccount({
          providerId,
          label: label.trim() || undefined,
          authKind: "oauth_token",
          secret: {
            kind: "oauth",
            credentials: {
              access_token: poll.credentials.access_token,
              refresh_token: poll.credentials.refresh_token,
              expires_at: poll.credentials.expires_at,
              scopes: poll.credentials.scopes,
              rate_limit_tier: poll.credentials.rate_limit_tier,
            },
          },
          display: {
            plan: poll.credentials.rate_limit_tier || "Claude OAuth",
          },
          default: setAsDefault,
        });

        setOAuthState({
          status: "success",
          statusText: copy.claudeSuccess,
          detailLines: buildAccountSummaryLines(copy, created),
        });
        return;
      }

      throw new Error(copy.claudeTimeout);
    } catch (err) {
      setOAuthState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const importGeminiCliOauth = async () => {
    if (!providerId) return;

    setLoading(true);
    setError(null);
    try {
      const imported = await invoke<GeminiCliOAuthImportResponse>("import_gemini_cli_oauth");
      const created = await onAddAccount({
        providerId,
        label: label.trim() || imported.email || undefined,
        authKind: "imported_cli_oauth",
        secret: {
          kind: "imported_cli_oauth",
          credentials: {
            access_token: imported.credentials.access_token,
            refresh_token: imported.credentials.refresh_token,
            expires_at: imported.credentials.expires_at,
            scopes: imported.credentials.scopes,
            rate_limit_tier: imported.credentials.rate_limit_tier,
          },
        },
        display: {
          email: imported.email,
          plan: imported.credentials.rate_limit_tier || "Gemini CLI OAuth",
        },
        default: setAsDefault,
      });

      setOAuthDialogOpen(true);
      setOAuthState({
        status: "success",
        statusText: copy.geminiSuccess,
        detailLines: buildAccountSummaryLines(copy, created),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const importQwenCliOauth = async () => {
    if (!providerId) return;

    setLoading(true);
    setError(null);
    try {
      const imported = await invoke<QwenCliOAuthImportResponse>("import_qwen_cli_oauth");
      const created = await onAddAccount({
        providerId,
        label: label.trim() || imported.email || "Qwen OAuth",
        authKind: "imported_cli_oauth",
        secret: {
          kind: "imported_cli_oauth",
          credentials: {
            access_token: imported.credentials.access_token,
            refresh_token: imported.credentials.refresh_token,
            expires_at: imported.credentials.expires_at,
            scopes: imported.credentials.scopes,
            rate_limit_tier: imported.credentials.rate_limit_tier,
          },
        },
        display: {
          email: imported.email,
          plan: imported.credentials.rate_limit_tier || "Qwen OAuth",
          browser_label: imported.resource_url,
        },
        default: setAsDefault,
      });

      setOAuthDialogOpen(true);
      setOAuthState({
        status: "success",
        statusText: copy.presets.qwen.success,
        detailLines: buildAccountSummaryLines(copy, created),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadQwenCliCandidates = async () => {
    setQwenCandidatesLoading(true);
    setError(null);
    try {
      const candidates = await invoke<QwenCliOAuthCandidate[]>("list_qwen_cli_oauth_accounts");
      setQwenCandidates(candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQwenCandidatesLoading(false);
    }
  };

  const importSelectedQwenCliOauth = async (filePath: string) => {
    if (!providerId) return;

    setLoading(true);
    setError(null);
    try {
      const imported = await invoke<QwenCliOAuthImportResponse>("import_qwen_cli_oauth_from_path", {
        filePath,
      });
      const created = await onAddAccount({
        providerId,
        label: label.trim() || imported.email || "Qwen OAuth",
        authKind: "imported_cli_oauth",
        secret: {
          kind: "imported_cli_oauth",
          credentials: {
            access_token: imported.credentials.access_token,
            refresh_token: imported.credentials.refresh_token,
            expires_at: imported.credentials.expires_at,
            scopes: imported.credentials.scopes,
            rate_limit_tier: imported.credentials.rate_limit_tier,
          },
        },
        display: {
          email: imported.email,
          plan: imported.credentials.rate_limit_tier || "Qwen OAuth",
          browser_label: imported.resource_url,
        },
        default: setAsDefault,
      });

      setOAuthDialogOpen(true);
      setOAuthState({
        status: "success",
        statusText: copy.presets.qwen.success,
        detailLines: buildAccountSummaryLines(copy, created),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const startIflowOauth = async () => {
    if (!providerId) return;

    setOAuthDialogOpen(true);
    setOAuthState({
      status: "starting",
      statusText: copy.presets.iflow.preparing,
    });

    try {
      const start = await invoke<IflowOAuthStartResponse>("start_iflow_oauth");
      await openInBrowser(start.auth_url);

      setOAuthState({
        status: "waiting",
        statusText: copy.presets.iflow.waiting,
      });

      const callback = await invoke<IflowCallbackResult>("iflow_wait_for_callback", {
        state: start.state,
        port: start.port,
      });

      setOAuthState({
        status: "exchanging",
        statusText: copy.presets.iflow.exchanging,
      });

      const tokens = await invoke<IflowTokenResponse>("iflow_exchange_token", {
        code: callback.code,
        port: start.port,
      });
      const user = await invoke<IflowUserInfoResponse>("get_iflow_user_info", {
        accessToken: tokens.access_token,
      });

      const created = await onAddAccount({
        providerId,
        label: label.trim() || user.email || undefined,
        authKind: "oauth_token",
        secret: {
          kind: "oauth",
          credentials: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || undefined,
            expires_at: tokens.expires_in
              ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
              : undefined,
            scopes: [],
          },
        },
        display: {
          email: user.email,
          plan: user.api_key ? "iFlow OAuth (API linked)" : "iFlow OAuth",
        },
        default: setAsDefault,
      });

      setOAuthState({
        status: "success",
        statusText: copy.presets.iflow.success,
        detailLines: buildAccountSummaryLines(copy, created),
      });
    } catch (err) {
      setOAuthState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const startAntigravityOauth = async () => {
    if (!providerId) return;

    const availability = await invoke<AntigravityOAuthAvailabilityResponse>(
      "get_antigravity_oauth_availability"
    );
    if (!availability.configured) {
      const missingList = availability.missing.join(", ");
      setOAuthDialogOpen(true);
      setOAuthState({
        status: "error",
        error:
          lang === "zh"
            ? `当前构建没有配置 Anti-Gravity OAuth，缺少 ${missingList}。请先补上这些环境变量，再使用 Google 登录流程。`
            : `Anti-Gravity OAuth is not configured in this build. Missing ${missingList}. Add these environment variables before using the Google sign-in flow.`,
      });
      return;
    }

    setOAuthDialogOpen(true);
    setOAuthState({
      status: "starting",
      statusText: copy.presets.antigravity.preparing,
    });

    try {
      const start = await invoke<AntigravityOAuthStartResponse>("start_antigravity_oauth");
      await openInBrowser(start.auth_url);

      setOAuthState({
        status: "waiting",
        statusText: copy.presets.antigravity.waiting,
      });

      const callback = await invoke<AntigravityCallbackResult>("antigravity_wait_for_callback", {
        state: start.state,
        port: start.port,
      });

      setOAuthState({
        status: "exchanging",
        statusText: copy.presets.antigravity.exchanging,
      });

      const tokens = await invoke<AntigravityTokenResponse>("antigravity_exchange_token", {
        code: callback.code,
        port: start.port,
      });
      const user = await invoke<AntigravityUserInfoResponse>("get_antigravity_user_info", {
        accessToken: tokens.access_token,
      });

      const created = await onAddAccount({
        providerId,
        label: label.trim() || user.email || undefined,
        authKind: "oauth_token",
        secret: {
          kind: "oauth",
          credentials: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || undefined,
            expires_at: tokens.expires_in
              ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
              : undefined,
            scopes: [],
          },
        },
        display: {
          email: user.email,
          plan: "Anti-Gravity OAuth",
        },
        default: setAsDefault,
      });

      setOAuthState({
        status: "success",
        statusText: copy.presets.antigravity.success,
        detailLines: buildAccountSummaryLines(copy, created),
      });
    } catch (err) {
      setOAuthState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const importKiroLocalSession = async () => {
    if (!providerId) return;

    setLoading(true);
    setError(null);
    try {
      const created = await onAddAccount({
        providerId,
        label: label.trim() || `${providerName} Local`,
        authKind: "local_detected",
        display: {
          plan: "Kiro local session",
        },
        default: setAsDefault,
      });

      setOAuthDialogOpen(true);
      setOAuthState({
        status: "success",
        statusText: copy.presets.kiro.success,
        detailLines: buildAccountSummaryLines(copy, created),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const triggerVertexFilePicker = () => {
    vertexFileInputRef.current?.click();
  };

  const loadVertexServiceAccountFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      parseVertexServiceAccountJson(text);
      setVertexServiceAccountText(text);
      setVertexServiceAccountFileName(file.name);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      event.target.value = "";
    }
  };

  const importVertexServiceAccount = async () => {
    if (!providerId) return;

    setLoading(true);
    setError(null);
    try {
      const credentials = parseVertexServiceAccountJson(vertexServiceAccountText);
      const validated = await invoke<VertexServiceAccountValidationResponse>(
        "validate_vertex_service_account",
        {
          input: { credentials },
        }
      );
      const created = await onAddAccount({
        providerId,
        label: label.trim() || validated.project_id,
        authKind: "service_account_json",
        secret: {
          kind: "service_account_json",
          credentials,
        },
        display: {
          email: validated.client_email,
          plan: validated.plan,
        },
        default: setAsDefault,
      });

      setOAuthDialogOpen(true);
      setOAuthState({
        status: "success",
        statusText: copy.presets.vertexai.success,
        detailLines: buildAccountSummaryLines(copy, created),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPortal = () => {
    if (!provider?.portalUrl) return;
    void openInBrowser(provider.portalUrl);
  };

  const showIdentityFields = false;
  const showAuthKindSwitch = providerId === "claude" && supportedAuthKinds.length > 1;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {providerId ? <ProviderIcon providerId={providerId} size={18} /> : null}
              <span>{presetText?.title ?? copy.connectFallback(providerName)}</span>
            </DialogTitle>
            <DialogDescription>
              {presetText?.summary ?? copy.summaryFallback(providerName)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {showIdentityFields ? (
              <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{copy.optionalLabel}</label>
                    <input
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                      placeholder={copy.optionalLabelPlaceholder(providerName)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {copy.optionalLabelHint}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 self-start rounded-xl border border-border/70 bg-card px-3 py-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={setAsDefault}
                      onChange={(event) => setSetAsDefault(event.target.checked)}
                    />
                    {copy.setAsDefault}
                  </label>
                </div>
              </div>
            ) : null}

            {showAuthKindSwitch ? (
              <div className="flex flex-wrap gap-2">
                {supportedAuthKinds.map((kind) => (
                  <button
                    key={kind}
                    onClick={() => setAuthKind(kind)}
                    className={
                      authKind === kind
                        ? "rounded-full border border-foreground/15 bg-foreground px-3 py-1 text-xs font-medium text-background"
                        : "rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-muted-foreground"
                    }
                  >
                    {kind === "oauth_token"
                      ? copy.authKinds.officialSignIn
                      : copy.authKinds.pasteImportedToken}
                  </button>
                ))}
              </div>
            ) : null}

            {error ? (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            {providerId &&
            ["cursor", "trae", "kiro"].includes(providerId) &&
            existingLocalSessionAccounts.length > 0 ? (
              <DuplicateWarningPanel
                title={copy.shared.possibleDuplicateAccounts}
                body={copy.shared.localSessionAlreadyAttached}
                detail={copy.shared.alreadyMonitoring(joinAccountLabels(existingLocalSessionAccounts))}
              />
            ) : null}

            {providerId === "codex" ? (
              oauthState.status === "idle" ? (
                <PrimaryActionPanel
                  providerId={providerId}
                  icon={<ShieldCheck className="size-4" />}
                  title={copy.presets.codex.primaryTitle}
                  summary={copy.presets.codex.primarySummary}
                  actionLabel={copy.presets.codex.primaryAction}
                  onAction={startCodexOauth}
                  minimal
                />
              ) : (
                <InlineOpenAiOauthPanel
                  lang={lang}
                  state={oauthState}
                  callbackUrl={openAiCallbackUrl}
                  onCallbackUrlChange={setOpenAiCallbackUrl}
                  onOpenLink={() => {
                    if (oauthState.authUrl) {
                      void openInBrowser(oauthState.authUrl);
                    }
                  }}
                  onCopyLink={() => void copyOpenAiLink()}
                  copied={openAiLinkCopied}
                  onVerify={() => void verifyOpenAiCallbackUrl()}
                  onCancel={() => {
                    setOAuthState({ status: "idle" });
                    setOpenAiAuthStart(null);
                    setOpenAiCallbackUrl("");
                  }}
                  onRetry={() => void startCodexOauth()}
                />
              )
            ) : null}

            {providerId === "copilot" ? (
              <PrimaryActionPanel
                providerId={providerId}
                icon={<Globe className="size-4" />}
                title={copy.presets.copilot.primaryTitle}
                summary={copy.presets.copilot.primarySummary}
                actionLabel={copy.presets.copilot.primaryAction}
                onAction={startCopilotDeviceFlow}
              />
            ) : null}

            {providerId === "claude" && authKind === "oauth_token" ? (
              <PrimaryActionPanel
                providerId={providerId}
                icon={<ShieldCheck className="size-4" />}
                title={copy.presets.claude.primaryTitle}
                summary={copy.presets.claude.primarySummary}
                actionLabel={copy.presets.claude.primaryAction}
                onAction={startClaudeOauth}
              />
            ) : null}

            {providerId === "claude" && authKind === "imported_cli_oauth" ? (
              <SecretForm
                secretLabel={copy.presets.claude.importedToken}
                secretPlaceholder={copy.presets.claude.importedTokenPlaceholder}
                secretValue={secretValue}
                onSecretChange={setSecretValue}
                refreshToken={refreshToken}
                onRefreshTokenChange={setRefreshToken}
                expiresAt={expiresAt}
                onExpiresAtChange={setExpiresAt}
                onCancel={() => onOpenChange(false)}
                onSubmit={submitManualAccount}
                submitLabel={copy.shared.importAccount}
                disabled={!canSubmitManual}
              />
            ) : null}

            {providerId === "qwen" ? (
              <div className="space-y-4">
                <PrimaryActionPanel
                  providerId={providerId}
                  icon={<ShieldCheck className="size-4" />}
                  title={copy.presets.qwen.primaryTitle}
                  summary={copy.presets.qwen.primarySummary}
                  actionLabel={copy.presets.qwen.primaryAction}
                  onAction={importQwenCliOauth}
                />
                <PrimaryActionPanel
                  providerId={providerId}
                  icon={<ScanSearch className="size-4" />}
                  title={copy.presets.qwen.multiAccountTitle}
                  summary={copy.presets.qwen.multiAccountSummary}
                  actionLabel={
                    qwenCandidatesLoading
                      ? copy.presets.qwen.scanning
                      : copy.presets.qwen.multiAccountAction
                  }
                  onAction={loadQwenCliCandidates}
                  disabled={qwenCandidatesLoading || loading}
                />
                {qwenCandidates.length > 0 ? (
                  <div className="space-y-2 rounded-2xl border border-border/70 bg-background/70 p-4">
                    <div className="flex items-center gap-2">
                      <ProviderIcon providerId={providerId} size={16} />
                      <p className="text-sm font-medium">{copy.shared.detectedLocalAccounts}</p>
                    </div>
                    <div className="space-y-2">
                      {qwenCandidates.map((candidate) => (
                        <div
                          key={candidate.file_path}
                          className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-3 py-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <ProviderIcon providerId={providerId} size={16} />
                              <p className="truncate text-sm font-medium">
                                {candidate.email || candidate.file_name}
                              </p>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {candidate.resource_url || candidate.file_name}
                              {candidate.expired ? ` · ${candidate.expired}` : ""}
                              {candidate.disabled ? " · disabled" : ""}
                            </p>
                            {qwenCandidateMatches[candidate.file_path]?.length ? (
                              <p className="mt-2 text-xs text-amber-700">
                                {describeDuplicateMatch(
                                  copy,
                                  qwenCandidateMatches[candidate.file_path][0].matchKind
                                )}{" "}
                                ·{" "}
                                {copy.shared.alreadyMonitoring(
                                  joinDuplicateLabels(qwenCandidateMatches[candidate.file_path])
                                )}
                              </p>
                            ) : null}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => importSelectedQwenCliOauth(candidate.file_path)}
                            disabled={loading || candidate.disabled}
                          >
                            {copy.shared.import}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <SecretForm
                  secretLabel={copy.presets.qwen.importedToken}
                  secretPlaceholder={copy.presets.qwen.importedTokenPlaceholder}
                  secretValue={secretValue}
                  onSecretChange={setSecretValue}
                  refreshToken={refreshToken}
                  onRefreshTokenChange={setRefreshToken}
                  expiresAt={expiresAt}
                  onExpiresAtChange={setExpiresAt}
                  onCancel={() => onOpenChange(false)}
                  onSubmit={submitManualAccount}
                  submitLabel={copy.shared.importManually}
                  disabled={!canSubmitManual}
                />
              </div>
            ) : null}

            {providerId === "gemini" ? (
              <div className="space-y-4">
                <PrimaryActionPanel
                  providerId={providerId}
                  icon={<MonitorSmartphone className="size-4" />}
                  title={copy.presets.gemini.primaryTitle}
                  summary={copy.presets.gemini.primarySummary}
                  actionLabel={copy.presets.gemini.primaryAction}
                  onAction={importGeminiCliOauth}
                />
                <SecretForm
                  secretLabel={copy.presets.gemini.accessToken}
                  secretPlaceholder={copy.presets.gemini.accessTokenPlaceholder}
                  secretValue={secretValue}
                  onSecretChange={setSecretValue}
                  refreshToken={refreshToken}
                  onRefreshTokenChange={setRefreshToken}
                  expiresAt={expiresAt}
                  onExpiresAtChange={setExpiresAt}
                  onCancel={() => onOpenChange(false)}
                  onSubmit={submitManualAccount}
                  submitLabel={copy.shared.importManually}
                  disabled={!canSubmitManual}
                />
              </div>
            ) : null}

            {providerId === "iflow" ? (
              <PrimaryActionPanel
                providerId={providerId}
                icon={<ShieldCheck className="size-4" />}
                title={copy.presets.iflow.primaryTitle}
                summary={copy.presets.iflow.primarySummary}
                actionLabel={copy.presets.iflow.primaryAction}
                onAction={startIflowOauth}
              />
            ) : null}

            {providerId === "vertexai" ? (
              <div className="space-y-4 rounded-2xl border border-border/70 bg-background/70 p-4">
                <input
                  ref={vertexFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={loadVertexServiceAccountFile}
                />
                <div className="flex items-start gap-3">
                  <div className="rounded-xl border border-border/70 bg-card p-2 text-foreground/80">
                    <ShieldCheck className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{copy.presets.vertexai.primaryTitle}</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {copy.presets.vertexai.primarySummary}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={triggerVertexFilePicker} disabled={loading}>
                    {vertexServiceAccountFileName
                      ? copy.shared.replaceJsonFile
                      : copy.shared.selectJsonFile}
                  </Button>
                  {vertexServiceAccountFileName ? (
                    <span className="text-xs text-muted-foreground">
                      {copy.shared.loadedJsonFile(vertexServiceAccountFileName)}
                    </span>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{copy.presets.vertexai.jsonLabel}</label>
                  <textarea
                    value={vertexServiceAccountText}
                    onChange={(event) => setVertexServiceAccountText(event.target.value)}
                    className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    placeholder={copy.presets.vertexai.jsonPlaceholder}
                  />
                  <p className="text-xs text-muted-foreground">
                    {copy.presets.vertexai.jsonHelper}
                  </p>
                </div>
                {vertexServiceAccountPreview ? (
                  <div className="rounded-xl border border-border/70 bg-card px-3 py-3 text-xs text-muted-foreground">
                    <p>{copy.shared.projectId}: {vertexServiceAccountPreview.project_id}</p>
                    <p>{copy.shared.serviceAccountEmail}: {vertexServiceAccountPreview.client_email}</p>
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    {copy.shared.cancel}
                  </Button>
                  <Button
                    onClick={importVertexServiceAccount}
                    disabled={!canSubmitVertexServiceAccount}
                  >
                    {copy.presets.vertexai.primaryAction}
                  </Button>
                </div>
              </div>
            ) : null}

            {providerId === "antigravity" ? (
              <PrimaryActionPanel
                providerId={providerId}
                icon={<ShieldCheck className="size-4" />}
                title={copy.presets.antigravity.primaryTitle}
                summary={copy.presets.antigravity.primarySummary}
                actionLabel={copy.presets.antigravity.primaryAction}
                onAction={startAntigravityOauth}
              />
            ) : null}

            {providerId === "kiro" ? (
              <PrimaryActionPanel
                providerId={providerId}
                icon={<MonitorSmartphone className="size-4" />}
                title={copy.presets.kiro.primaryTitle}
                summary={copy.presets.kiro.primarySummary}
                actionLabel={copy.presets.kiro.primaryAction}
                onAction={importKiroLocalSession}
                disabled={loading}
              />
            ) : null}

            {providerId === "cursor" ? (
              <div className="space-y-4">
                <PrimaryActionPanel
                  providerId={providerId}
                  icon={<MonitorSmartphone className="size-4" />}
                  title={copy.presets.cursor.localSessionTitle}
                  summary={copy.presets.cursor.localSessionSummary}
                  actionLabel={copy.presets.cursor.localSessionAction}
                  onAction={importCursorLocalSession}
                  disabled={loading || cursorProfilesLoading}
                />

                <PrimaryActionPanel
                  providerId={providerId}
                  icon={<Globe className="size-4" />}
                  title={copy.presets.cursor.browserLoginTitle}
                  summary={copy.presets.cursor.browserLoginSummary}
                  actionLabel={copy.presets.cursor.browserLoginAction}
                  onAction={startCursorBrowserLogin}
                  disabled={loading || cursorProfilesLoading}
                />

                <PrimaryActionPanel
                  providerId={providerId}
                  icon={<ScanSearch className="size-4" />}
                  title={copy.presets.cursor.primaryTitle}
                  summary={copy.presets.cursor.primarySummary}
                  actionLabel={
                    cursorProfilesLoading
                      ? copy.presets.cursor.scanning
                      : copy.presets.cursor.primaryAction
                  }
                  onAction={loadCursorBrowserProfiles}
                  disabled={cursorProfilesLoading || loading}
                />

                {cursorProfiles.length > 0 ? (
                  <div className="space-y-2 rounded-2xl border border-border/70 bg-background/70 p-4">
                    <div className="flex items-center gap-2">
                      <ProviderIcon providerId={providerId} size={16} />
                      <p className="text-sm font-medium">{copy.shared.detectedBrowserAccounts}</p>
                    </div>
                    <div className="space-y-2">
                      {cursorProfiles.map((profile) => (
                        <div
                          key={profile.browser_label}
                          className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-3 py-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <ProviderIcon providerId={providerId} size={16} />
                              <p className="truncate text-sm font-medium">{profile.browser_label}</p>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {profile.email ?? copy.shared.emailNotDetected}
                              {profile.plan ? ` · ${profile.plan}` : ""}
                            </p>
                            {cursorProfileMatches[profile.browser_label]?.length ? (
                              <p className="mt-2 text-xs text-amber-700">
                                {describeDuplicateMatch(
                                  copy,
                                  cursorProfileMatches[profile.browser_label][0].matchKind
                                )}{" "}
                                ·{" "}
                                {copy.shared.alreadyMonitoring(
                                  joinDuplicateLabels(cursorProfileMatches[profile.browser_label])
                                )}
                              </p>
                            ) : null}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => importCursorBrowserProfile(profile.browser_label)}
                            disabled={loading}
                          >
                            {copy.shared.import}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <SecretForm
                  secretLabel={copy.presets.cursor.manualCookieFallback}
                  secretPlaceholder={copy.presets.cursor.manualCookiePlaceholder}
                  secretValue={secretValue}
                  onSecretChange={setSecretValue}
                  multiline
                  onCancel={() => onOpenChange(false)}
                  onSubmit={submitManualAccount}
                  submitLabel={copy.shared.addWithCookie}
                  disabled={!canSubmitManual}
                  helperText={copy.presets.cursor.manualCookieHelper}
                />
              </div>
            ) : null}

            {providerId === "trae" ? (
              <div className="space-y-4">
                <PrimaryActionPanel
                  providerId={providerId}
                  icon={<Globe className="size-4" />}
                  title={copy.presets.trae.browserLoginTitle}
                  summary={copy.presets.trae.browserLoginSummary}
                  actionLabel={copy.presets.trae.browserLoginAction}
                  onAction={startTraeBrowserLogin}
                  disabled={loading}
                />
                <PrimaryActionPanel
                  providerId={providerId}
                  icon={<MonitorSmartphone className="size-4" />}
                  title={copy.presets.trae.primaryTitle}
                  summary={copy.presets.trae.primarySummary}
                  actionLabel={copy.presets.trae.primaryAction}
                  onAction={importTraeLocalSession}
                  disabled={loading}
                />
              </div>
            ) : null}

            {providerId && ["factory", "kimi", "ollama", "opencode"].includes(providerId) ? (
              <SecretForm
                secretLabel={copy.presets.sessionCookie}
                secretPlaceholder={copy.presets.sessionCookiePlaceholder}
                secretValue={secretValue}
                onSecretChange={setSecretValue}
                multiline
                onCancel={() => onOpenChange(false)}
                onSubmit={submitManualAccount}
                submitLabel={copy.shared.addAccount}
                disabled={!canSubmitManual}
              />
            ) : null}

            {providerId &&
            [
              "openrouter",
              "warp",
              "zai",
              "kimik2",
              "amp",
              "augment",
              "minimax",
              "synthetic",
            ].includes(providerId) ? (
              <SecretForm
                secretLabel={copy.presets.apiKey.apiKey}
                secretPlaceholder={copy.presets.apiKey.apiKeyPlaceholder}
                secretValue={secretValue}
                onSecretChange={setSecretValue}
                onCancel={() => onOpenChange(false)}
                onSubmit={submitManualAccount}
                submitLabel={copy.shared.addAccount}
                disabled={!canSubmitManual}
              />
            ) : null}

            {preset?.mode === "system" ? (
              <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <p className="text-sm leading-6 text-muted-foreground">
                  {presetText?.summary ?? copy.summaryFallback(providerName)}
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  {provider?.portalUrl ? (
                    <Button variant="outline" onClick={handleOpenPortal}>
                      <ExternalLink className="size-4" />
                      {copy.shared.openProvider}
                    </Button>
                  ) : null}
                  <Button onClick={() => onOpenChange(false)}>{copy.shared.close}</Button>
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <DeviceFlowDialog
        open={deviceDialogOpen}
        onOpenChange={(nextOpen) => {
          setDeviceDialogOpen(nextOpen);
          if (!nextOpen && deviceFlow.status === "success") {
            onOpenChange(false);
          }
        }}
        state={deviceFlow}
        onStartFlow={startCopilotDeviceFlow}
      />

      <OAuthFlowDialog
        open={oauthDialogOpen && providerId !== "codex"}
        onOpenChange={(nextOpen) => {
          setOAuthDialogOpen(nextOpen);
          if (!nextOpen && oauthState.status === "success") {
            onOpenChange(false);
          }
        }}
        providerName={providerName}
        state={oauthState}
        onStartFlow={
          providerId === "claude"
            ? startClaudeOauth
            : providerId === "codex"
              ? startCodexOauth
              : providerId === "iflow"
                ? startIflowOauth
                : providerId === "qwen"
                  ? importQwenCliOauth
                  : providerId === "antigravity"
                    ? startAntigravityOauth
                    : providerId === "kiro"
                      ? importKiroLocalSession
                      : providerId === "cursor"
                        ? startCursorBrowserLogin
                        : providerId === "trae"
                          ? importTraeLocalSession
                          : providerId === "gemini"
                            ? importGeminiCliOauth
                            : startCodexOauth
        }
      />
    </>
  );
}

function PrimaryActionPanel({
  providerId,
  icon,
  title,
  summary,
  actionLabel,
  onAction,
  disabled,
  minimal = false,
}: {
  providerId?: ProviderId | null;
  icon: ReactNode;
  title: string;
  summary: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  minimal?: boolean;
}) {
  return (
    <div className="py-1">
      {!minimal ? (
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0 text-foreground/75">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              {providerId ? <ProviderIcon providerId={providerId} size={16} /> : null}
              <span>{title}</span>
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{summary}</p>
          </div>
        </div>
      ) : null}
      <div className={cn("flex justify-center", minimal ? "" : "mt-4")}>
        <Button onClick={onAction} disabled={disabled}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

function InlineOpenAiOauthPanel({
  lang,
  state,
  callbackUrl,
  onCallbackUrlChange,
  onOpenLink,
  onCopyLink,
  copied,
  onVerify,
  onCancel,
  onRetry,
}: {
  lang: string;
  state: InlineOpenAiFlowState;
  callbackUrl: string;
  onCallbackUrlChange: (value: string) => void;
  onOpenLink: () => void;
  onCopyLink: () => void;
  copied: boolean;
  onVerify: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const waitingText = lang === "zh" ? "等待认证..." : "Waiting for authentication...";
  const browserText = lang === "zh" ? "在浏览器中完成登录" : "Finish sign-in in your browser";
  const openText = lang === "zh" ? "打开链接" : "Open link";
  const copyText = copied ? (lang === "zh" ? "已复制" : "Copied") : lang === "zh" ? "复制" : "Copy";
  const pasteHint = lang === "zh" ? "如果未自动检测到回调：" : "If the callback is not detected automatically:";
  const pastePlaceholder = lang === "zh" ? "在此粘贴回调 URL..." : "Paste callback URL here...";
  const verifyText = lang === "zh" ? "验证" : "Verify";
  const cancelText = lang === "zh" ? "取消" : "Cancel";
  const retryText = lang === "zh" ? "重试" : "Retry";

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-3">
        <p className="text-lg font-semibold">OpenAI Codex</p>
        <p className="text-sm text-muted-foreground">
          {state.status === "error" ? state.error : state.statusText || waitingText}
        </p>
      </div>

      {state.status !== "success" ? (
        <>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className={cn("size-4", state.status !== "error" && "animate-spin")} />
            <span>{browserText}</span>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onOpenLink} disabled={!state.authUrl}>
              <ExternalLink className="size-4" />
              {openText}
            </Button>
            <Button variant="outline" onClick={onCopyLink} disabled={!state.authUrl}>
              <Copy className="size-4" />
              {copyText}
            </Button>
          </div>

          <div className="border-t border-border/70 pt-3">
            <p className="mb-2 text-sm text-muted-foreground">{pasteHint}</p>
            <div className="flex gap-2">
              <input
                value={callbackUrl}
                onChange={(event) => onCallbackUrlChange(event.target.value)}
                placeholder={pastePlaceholder}
                className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
              />
              <Button onClick={onVerify} disabled={!callbackUrl.trim()}>
                {verifyText}
              </Button>
            </div>
          </div>

          {state.status === "error" ? (
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={onCancel}>
                {cancelText}
              </Button>
              <Button onClick={onRetry}>{retryText}</Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-500" />
            <span>{state.statusText}</span>
          </div>
          {state.detailLines?.length ? (
            <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-xs">
              {state.detailLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function DuplicateWarningPanel({
  title,
  body,
  detail,
}: {
  title: string;
  body: string;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-amber-900">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-sm leading-6">{body}</p>
          {detail ? <p className="mt-2 text-xs text-amber-800/80">{detail}</p> : null}
        </div>
      </div>
    </div>
  );
}

function SecretForm({
  secretLabel,
  secretPlaceholder,
  secretValue,
  onSecretChange,
  refreshToken,
  onRefreshTokenChange,
  expiresAt,
  onExpiresAtChange,
  multiline,
  helperText,
  onCancel,
  onSubmit,
  submitLabel,
  disabled,
}: {
  secretLabel: string;
  secretPlaceholder: string;
  secretValue: string;
  onSecretChange: (value: string) => void;
  refreshToken?: string;
  onRefreshTokenChange?: (value: string) => void;
  expiresAt?: string;
  onExpiresAtChange?: (value: string) => void;
  multiline?: boolean;
  helperText?: string;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled: boolean;
}) {
  const { lang } = useI18n();
  const copy = getProductCopy(lang).addAccount;
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-background/70 p-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">{secretLabel}</label>
        {multiline ? (
          <textarea
            value={secretValue}
            onChange={(event) => onSecretChange(event.target.value)}
            className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            placeholder={secretPlaceholder}
          />
        ) : (
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="password"
              value={secretValue}
              onChange={(event) => onSecretChange(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              placeholder={secretPlaceholder}
            />
          </div>
        )}
        {helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null}
      </div>

      {onRefreshTokenChange ? (
        <div className="space-y-2">
          <label className="text-sm font-medium">{copy.shared.refreshToken}</label>
          <input
            type="password"
            value={refreshToken ?? ""}
            onChange={(event) => onRefreshTokenChange(event.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            placeholder={copy.shared.refreshTokenPlaceholder}
          />
        </div>
      ) : null}

      {onExpiresAtChange ? (
        <div className="space-y-2">
          <label className="text-sm font-medium">{copy.shared.expiresAt}</label>
          <input
            type="text"
            value={expiresAt ?? ""}
            onChange={(event) => onExpiresAtChange(event.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            placeholder={copy.shared.expiresAtPlaceholder}
          />
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          {copy.shared.cancel}
        </Button>
        <Button onClick={onSubmit} disabled={disabled}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
