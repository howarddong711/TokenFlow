import type { ProviderId } from "@/types";

export type ApiKeyProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "deepseek"
  | "groq"
  | "mistral"
  | "together"
  | "fireworks"
  | "cohere"
  | "xai"
  | "perplexity"
  | "siliconflow"
  | "volcengine"
  | "zai"
  | "kimi"
  | "qwen"
  | "minimax"
  | "stepfun"
  | "hunyuan"
  | "baichuan";

export interface ApiKeyVaultEntry {
  provider: ApiKeyProviderId;
  label: string;
  apiKey: string;
  baseUrl: string;
  updatedAt: string;
  lastCopiedAt?: string;
}

export interface ApiKeyProviderMeta {
  id: ApiKeyProviderId;
  name: string;
  region: "global" | "china";
  color: string;
  iconProviderId?: ProviderId;
  monogram: string;
}

export const API_KEY_PROVIDERS: ApiKeyProviderMeta[] = [
  {
    id: "openai",
    name: "OpenAI",
    region: "global",
    color: "#18A874",
    iconProviderId: "codex",
    monogram: "OA",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    region: "global",
    color: "#C98A4A",
    iconProviderId: "claude",
    monogram: "AN",
  },
  {
    id: "gemini",
    name: "Gemini",
    region: "global",
    color: "#4D7CFE",
    iconProviderId: "gemini",
    monogram: "GM",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    region: "global",
    color: "#7C3AED",
    iconProviderId: "openrouter",
    monogram: "OR",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    region: "global",
    color: "#2563EB",
    monogram: "DS",
  },
  {
    id: "groq",
    name: "Groq",
    region: "global",
    color: "#0F172A",
    monogram: "GQ",
  },
  {
    id: "mistral",
    name: "Mistral",
    region: "global",
    color: "#F97316",
    monogram: "MS",
  },
  {
    id: "together",
    name: "Together AI",
    region: "global",
    color: "#0EA5E9",
    monogram: "TG",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    region: "global",
    color: "#EF4444",
    monogram: "FW",
  },
  {
    id: "cohere",
    name: "Cohere",
    region: "global",
    color: "#14B8A6",
    monogram: "CO",
  },
  {
    id: "xai",
    name: "xAI",
    region: "global",
    color: "#111827",
    monogram: "xA",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    region: "global",
    color: "#059669",
    monogram: "PX",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    region: "china",
    color: "#2563EB",
    monogram: "SF",
  },
  {
    id: "volcengine",
    name: "Volcengine",
    region: "china",
    color: "#F97316",
    monogram: "VE",
  },
  {
    id: "zai",
    name: "z.ai",
    region: "china",
    color: "#EC4899",
    iconProviderId: "zai",
    monogram: "ZA",
  },
  {
    id: "kimi",
    name: "Kimi",
    region: "china",
    color: "#EF4444",
    iconProviderId: "kimi",
    monogram: "KM",
  },
  {
    id: "qwen",
    name: "Qwen",
    region: "china",
    color: "#7A4DFF",
    iconProviderId: "qwen",
    monogram: "QW",
  },
  {
    id: "minimax",
    name: "MiniMax",
    region: "china",
    color: "#F59E0B",
    iconProviderId: "minimax",
    monogram: "MM",
  },
  {
    id: "stepfun",
    name: "StepFun",
    region: "china",
    color: "#06B6D4",
    monogram: "ST",
  },
  {
    id: "hunyuan",
    name: "Tencent Hunyuan",
    region: "china",
    color: "#0F766E",
    monogram: "HY",
  },
  {
    id: "baichuan",
    name: "Baichuan",
    region: "china",
    color: "#DC2626",
    monogram: "BC",
  },
];

export const API_KEY_PROVIDER_MAP = Object.fromEntries(
  API_KEY_PROVIDERS.map((provider) => [provider.id, provider])
) as Record<ApiKeyProviderId, ApiKeyProviderMeta>;

export const GLOBAL_API_KEY_PROVIDERS = API_KEY_PROVIDERS.filter(
  (provider) => provider.region === "global"
);

export const CHINA_API_KEY_PROVIDERS = API_KEY_PROVIDERS.filter(
  (provider) => provider.region === "china"
);
