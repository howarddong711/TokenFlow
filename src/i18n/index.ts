import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import en from "@/i18n/en";
import zh from "@/i18n/zh";

const STORAGE_KEY = "tokenflow-lang";

export type Language = "en" | "zh" | "ja" | "ko" | "fr" | "de" | "es";

type Messages = Record<string, string>;

const MESSAGES: Partial<Record<Language, Messages>> = {
  en,
  zh,
};

const SUPPORTED_LANGUAGES: Language[] = ["en", "zh", "ja", "ko", "fr", "de", "es"];

interface I18nContextValue {
  t: (key: string, vars?: Record<string, string | number>) => string;
  lang: Language;
  setLang: (lang: Language) => void;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function getInitialLanguage(): Language {
  if (typeof window === "undefined") {
    return "en";
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);
  return SUPPORTED_LANGUAGES.includes(saved as Language) ? (saved as Language) : "en";
}

function formatMessage(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const setLang = useCallback((nextLang: Language) => {
    setLangState(nextLang);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const template = MESSAGES[lang]?.[key] ?? MESSAGES.en?.[key] ?? key;
      return formatMessage(template, vars);
    },
    [lang]
  );

  const value = useMemo(
    () => ({
      t,
      lang,
      setLang,
    }),
    [t, lang, setLang]
  );

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}
