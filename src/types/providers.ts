/**
 * Supported AI providers — matches Rust ProviderId::cli_name() values
 */
export type ProviderId =
  | "codex"       // OpenAI Codex
  | "claude"      // Anthropic Claude
  | "qwen"        // Qwen Code
  | "cursor"      // Cursor
  | "trae"        // Trae
  | "factory"     // Factory / Windsurf
  | "gemini"      // Google Gemini
  | "iflow"       // iFlow
  | "antigravity" // Anti-Gravity
  | "copilot"     // GitHub Copilot
  | "zai"         // z.ai
  | "minimax"     // MiniMax
  | "kiro"        // AWS Kiro
  | "vertexai"    // Google Vertex AI
  | "augment"     // Augment Code
  | "opencode"    // OpenCode
  | "kimi"        // Moonshot Kimi
  | "kimik2"      // Kimi K2
  | "amp"         // Amp (Sourcegraph)
  | "warp"        // Warp
  | "ollama"      // Ollama (local)
  | "openrouter"  // OpenRouter
  | "synthetic"   // Synthetic
  | "jetbrains";  // JetBrains AI

/**
 * Provider display metadata
 */
export interface ProviderMeta {
  id: ProviderId;
  name: string;
  description: string;
  color: string;
  icon: string;
  portalUrl?: string;
}

/**
 * Authentication status for a provider
 */
export type AuthStatus = "disconnected" | "connecting" | "connected" | "error";

export type AccountAuthKind =
  | "oauth_token"
  | "api_key"
  | "service_account_json"
  | "manual_cookie"
  | "browser_profile_cookie"
  | "imported_cli_oauth"
  | "local_detected";

export interface OAuthCredentialsPayload {
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  scopes: string[];
  rate_limit_tier?: string;
}

export type AccountSecretInput =
  | { kind: "oauth"; credentials: OAuthCredentialsPayload }
  | { kind: "api_key"; value: string }
  | {
      kind: "service_account_json";
      credentials: {
        project_id: string;
        client_email: string;
        private_key: string;
        token_uri: string;
      };
    }
  | { kind: "manual_cookie"; cookie_header: string }
  | { kind: "browser_profile_cookie"; browser_label: string; cookie_header: string }
  | { kind: "imported_cli_oauth"; credentials: OAuthCredentialsPayload };

export interface AccountDisplayDto {
  username?: string;
  email?: string;
  avatar_url?: string;
  plan?: string;
  browser_label?: string;
  session_health?: "fresh" | "stale" | "expired" | "invalid";
  session_health_reason?: string;
  session_checked_at?: string;
}

export interface AccountRecordDto {
  id: string;
  provider_id: ProviderId;
  label: string;
  auth_kind: AccountAuthKind;
  default: boolean;
  secret_ref?: {
    service: string;
    key: string;
  };
  display: AccountDisplayDto;
  system_managed: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderCapabilityDto {
  provider: ProviderId;
  auth_kinds: AccountAuthKind[];
  prefers_native_oauth: boolean;
  system_managed_only: boolean;
}

export type OpenAIAuthMode = "api_key" | "chatgpt_oauth";

export type OpenAIPlan =
  | "free"
  | "go"
  | "plus"
  | "pro"
  | "team"
  | "business"
  | "enterprise"
  | "edu";

/**
 * Provider subscription/plan type
 */
export interface SubscriptionInfo {
  plan: string;
  status: "active" | "expired" | "trial" | "unknown";
  expiresAt?: string;
}

export interface RateWindowDto {
  used_percent: number;
  window_minutes?: number;
  resets_at?: string;
  reset_description?: string;
}

export interface UsageSnapshotDto {
  primary: RateWindowDto;
  secondary?: RateWindowDto;
  model_specific?: RateWindowDto;
  extra_windows?: Array<{
    id: string;
    label: string;
    kind?: "window" | "cost" | "credit" | "model" | "usage";
    window: RateWindowDto;
  }>;
  updated_at: string;
  account_email?: string;
  account_organization?: string;
  login_method?: string;
}

export interface CostSnapshotDto {
  used: number;
  limit?: number;
  currency_code: string;
  period: string;
  resets_at?: string;
}

export interface ProviderFetchResultDto {
  usage: UsageSnapshotDto;
  cost?: CostSnapshotDto;
  source_label: string;
}

/**
 * Token usage/quota information
 */
export interface TokenQuota {
  used: number;
  total: number;
  /** "unlimited" when provider doesn't enforce limits */
  unlimited: boolean;
  /** Reset date for quota cycle */
  resetsAt?: string;
  /** Unit label (e.g., "requests", "tokens", "credits") */
  unit: string;
  /** Render without a progress bar when total is unknown */
  displayMode?: "progress" | "stat";
  /** Optional preformatted value for stat display */
  valueLabel?: string;
  /** Optional provider-derived remaining amount */
  remaining?: number;
  /** Optional provider-derived remaining percentage (0-100) */
  remainingPercent?: number;
}

/**
 * A single quota category (e.g., Session window, Weekly, Cost, etc.)
 */
export interface QuotaCategory {
  name: string;
  quota: TokenQuota;
  kind?: "window" | "cost" | "credit" | "model" | "usage";
}

export type UsageWindowRole = "primary" | "secondary" | "model_specific" | "cost" | "custom";

export interface ProviderUsageWindow {
  id: string;
  name: string;
  label: string;
  role: UsageWindowRole;
  quota: TokenQuota;
  kind?: "window" | "cost" | "credit" | "model" | "usage";
  official: boolean;
}

export interface ProviderUsageSnapshot {
  windows: ProviderUsageWindow[];
  headlineWindowId?: string;
}

/**
 * Full provider account state
 */
export interface ProviderAccount {
  accountId: string;
  providerId: ProviderId;
  accountAuthKind?: AccountAuthKind;
  authStatus: AuthStatus;
  alias?: string;
  isDefault?: boolean;
  username?: string;
  email?: string;
  organization?: string;
  browserLabel?: string;
  avatarUrl?: string;
  subscription?: SubscriptionInfo;
  usage?: ProviderUsageSnapshot;
  quotas: QuotaCategory[];
  createdAt?: string;
  lastFetchedAt?: string;
  /** Access token (persisted in store, not displayed in UI) */
  accessToken?: string;
  /** Refresh token for OAuth providers */
  refreshToken?: string;
  openaiAuthMode?: OpenAIAuthMode;
  openaiPlan?: OpenAIPlan;
  sourceLabel?: string;
  sessionHealth?: "fresh" | "stale" | "expired" | "invalid";
  sessionHealthReason?: string;
  sessionCheckedAt?: string;
  error?: string;
}

export interface ProviderStatusResult {
  plan: string;
  access_type_sku?: string;
  token_expires_at?: number;
  quotas: QuotaCategory[];
}

/**
 * GitHub Device Flow code response
 */
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * GitHub OAuth token response
 */
export interface GithubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

/**
 * Copilot token (internal API token derived from GitHub token)
 */
export interface CopilotToken {
  token: string;
  expires_at: number;
}

/**
 * Provider metadata registry
 */
export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  codex: {
    id: "codex",
    name: "OpenAI Codex",
    description: "OpenAI Codex CLI coding agent",
    color: "#18A874",
    icon: "openai",
    portalUrl: "https://platform.openai.com/usage",
  },
  claude: {
    id: "claude",
    name: "Claude",
    description: "Anthropic Claude AI assistant",
    color: "#C98A4A",
    icon: "anthropic",
    portalUrl: "https://claude.ai",
  },
  qwen: {
    id: "qwen",
    name: "Qwen Code",
    description: "Qwen coding account connectivity",
    color: "#7A4DFF",
    icon: "qwen",
    portalUrl: "https://portal.qwen.ai",
  },
  cursor: {
      id: "cursor",
      name: "Cursor",
      description: "AI-powered code editor",
      color: "#111827",
      icon: "cursor",
      portalUrl: "https://cursor.com",
    },
  trae: {
    id: "trae",
    name: "Trae",
    description: "Trae AI coding IDE quota tracking",
    color: "#149EE7",
    icon: "trae",
    portalUrl: "https://www.trae.ai",
  },
  factory: {
    id: "factory",
    name: "Windsurf / Factory",
    description: "Windsurf AI coding IDE",
    color: "#06B6C8",
    icon: "factory",
    portalUrl: "https://windsurf.com",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    description: "Google Gemini CLI multimodal AI",
    color: "#4D7CFE",
    icon: "gemini",
    portalUrl: "https://aistudio.google.com/app/quota",
  },
  iflow: {
    id: "iflow",
    name: "iFlow",
    description: "iFlow coding subscription",
    color: "#14B8C4",
    icon: "iflow",
    portalUrl: "https://iflow.cn",
  },
  antigravity: {
    id: "antigravity",
    name: "Anti-Gravity",
    description: "Coding subscription channel",
    color: "#9A5CF8",
    icon: "antigravity",
  },
  copilot: {
    id: "copilot",
    name: "GitHub Copilot",
    description: "AI pair programmer powered by OpenAI",
    color: "#5A5CE6",
    icon: "github",
    portalUrl: "https://github.com/settings/copilot",
  },
  zai: {
    id: "zai",
    name: "z.ai",
    description: "z.ai cloud AI platform",
    color: "#ec4899",
    icon: "zai",
    portalUrl: "https://z.ai",
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    description: "MiniMax AI models",
    color: "#f59e0b",
    icon: "minimax",
    portalUrl: "https://minimax.io",
  },
  kiro: {
    id: "kiro",
    name: "Kiro",
    description: "AWS Kiro AI coding assistant",
    color: "#0F766E",
    icon: "kiro",
  },
  vertexai: {
    id: "vertexai",
    name: "Vertex AI",
    description: "Google Vertex AI project quota",
    color: "#2F6EEA",
    icon: "vertex",
    portalUrl: "https://console.cloud.google.com/vertex-ai",
  },
  augment: {
    id: "augment",
    name: "Augment Code",
    description: "Augment AI coding assistant",
    color: "#7c3aed",
    icon: "augment",
    portalUrl: "https://augmentcode.com",
  },
  opencode: {
      id: "opencode",
      name: "OpenCode",
      description: "Open source AI coding agent",
      color: "#9CA3AF",
      icon: "opencode",
    },
  kimi: {
    id: "kimi",
    name: "Kimi",
    description: "Moonshot Kimi AI models",
    color: "#ef4444",
    icon: "kimi",
    portalUrl: "https://platform.moonshot.cn/console",
  },
  kimik2: {
    id: "kimik2",
    name: "Kimi K2",
    description: "Moonshot Kimi K2 next-gen model",
    color: "#dc2626",
    icon: "kimi",
    portalUrl: "https://platform.moonshot.cn/console",
  },
  amp: {
    id: "amp",
    name: "Amp",
    description: "Sourcegraph Amp AI coding agent",
    color: "#f97316",
    icon: "amp",
    portalUrl: "https://sourcegraph.com",
  },
  warp: {
    id: "warp",
    name: "Warp",
    description: "Warp AI terminal",
    color: "#2850C7",
    icon: "warp",
    portalUrl: "https://warp.dev",
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    description: "Local AI model runner",
    color: "#374151",
    icon: "ollama",
    portalUrl: "http://localhost:11434",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    description: "AI model routing platform",
    color: "#7c3aed",
    icon: "openrouter",
    portalUrl: "https://openrouter.ai",
  },
  synthetic: {
    id: "synthetic",
    name: "Synthetic",
    description: "Synthetic AI platform",
    color: "#6366f1",
    icon: "synthetic",
  },
  jetbrains: {
    id: "jetbrains",
    name: "JetBrains AI",
    description: "JetBrains AI assistant",
    color: "#fe315d",
    icon: "jetbrains",
    portalUrl: "https://www.jetbrains.com/ai/",
  },
};
