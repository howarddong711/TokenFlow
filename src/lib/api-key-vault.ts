import deepseekIcon from "@/assets/provider-icons/api-keys/deepseek.ico";
import openrouterIcon from "@/assets/provider-icons/api-keys/openrouter.ico";
import siliconflowIcon from "@/assets/provider-icons/api-keys/siliconflow.ico";
import xaiIcon from "@/assets/provider-icons/api-keys/xai.ico";
import kimiIcon from "@/assets/provider-icons/api-keys/kimi.ico";
import minimaxIcon from "@/assets/provider-icons/api-keys/minimax.ico";
import hunyuanIcon from "@/assets/provider-icons/api-keys/hunyuan.ico";
import baichuanIcon from "@/assets/provider-icons/api-keys/baichuan.png";
import cohereIcon from "@/assets/provider-icons/api-keys/cohere.png";
import mistralIcon from "@/assets/provider-icons/api-keys/mistral.png";
import stepfunIcon from "@/assets/provider-icons/api-keys/stepfun.png";
import togetherIcon from "@/assets/provider-icons/api-keys/together.png";
import volcengineIcon from "@/assets/provider-icons/api-keys/volcengine.png";
import fireworksIcon from "@/assets/provider-icons/api-keys/fireworks.svg";
import groqIcon from "@/assets/provider-icons/api-keys/groq.svg";
import perplexityIcon from "@/assets/provider-icons/api-keys/perplexity.svg";
import zaiIcon from "@/assets/provider-icons/api-keys/zai.svg";
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
  id: string;
  provider: ApiKeyProviderId;
  label: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
  updatedAt: string;
  lastCopiedAt?: string;
}

export type ApiKeyVaultEntryInput = Pick<
  ApiKeyVaultEntry,
  "provider" | "label" | "apiKey" | "baseUrl" | "models"
>;

export interface ApiKeyProviderMeta {
  id: ApiKeyProviderId;
  name: string;
  region: "global" | "china";
  color: string;
  iconProviderId?: ProviderId;
  iconSrc?: string;
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
    iconSrc: openrouterIcon,
    monogram: "OR",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    region: "global",
    color: "#2563EB",
    iconSrc: deepseekIcon,
    monogram: "DS",
  },
  {
    id: "groq",
    name: "Groq",
    region: "global",
    color: "#0F172A",
    iconSrc: groqIcon,
    monogram: "GQ",
  },
  {
    id: "mistral",
    name: "Mistral",
    region: "global",
    color: "#F97316",
    iconSrc: mistralIcon,
    monogram: "MS",
  },
  {
    id: "together",
    name: "Together AI",
    region: "global",
    color: "#0EA5E9",
    iconSrc: togetherIcon,
    monogram: "TG",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    region: "global",
    color: "#EF4444",
    iconSrc: fireworksIcon,
    monogram: "FW",
  },
  {
    id: "cohere",
    name: "Cohere",
    region: "global",
    color: "#14B8A6",
    iconSrc: cohereIcon,
    monogram: "CO",
  },
  {
    id: "xai",
    name: "xAI",
    region: "global",
    color: "#111827",
    iconSrc: xaiIcon,
    monogram: "xA",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    region: "global",
    color: "#059669",
    iconSrc: perplexityIcon,
    monogram: "PX",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    region: "china",
    color: "#2563EB",
    iconSrc: siliconflowIcon,
    monogram: "SF",
  },
  {
    id: "volcengine",
    name: "Volcengine",
    region: "china",
    color: "#F97316",
    iconSrc: volcengineIcon,
    monogram: "VE",
  },
  {
    id: "zai",
    name: "z.ai",
    region: "china",
    color: "#EC4899",
    iconSrc: zaiIcon,
    monogram: "ZA",
  },
  {
    id: "kimi",
    name: "Kimi",
    region: "china",
    color: "#EF4444",
    iconSrc: kimiIcon,
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
    iconSrc: minimaxIcon,
    monogram: "MM",
  },
  {
    id: "stepfun",
    name: "StepFun",
    region: "china",
    color: "#06B6D4",
    iconSrc: stepfunIcon,
    monogram: "ST",
  },
  {
    id: "hunyuan",
    name: "Tencent Hunyuan",
    region: "china",
    color: "#0F766E",
    iconSrc: hunyuanIcon,
    monogram: "HY",
  },
  {
    id: "baichuan",
    name: "Baichuan",
    region: "china",
    color: "#DC2626",
    iconSrc: baichuanIcon,
    monogram: "BC",
  },
];

export const API_KEY_PROVIDER_MAP = Object.fromEntries(
  API_KEY_PROVIDERS.map((provider) => [provider.id, provider])
) as Record<ApiKeyProviderId, ApiKeyProviderMeta>;

export const SORTED_API_KEY_PROVIDERS = [...API_KEY_PROVIDERS].sort((left, right) =>
  left.name.localeCompare(right.name, "zh-Hans-CN", { sensitivity: "base" })
);
