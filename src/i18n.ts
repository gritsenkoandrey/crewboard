import { useCallback, useSyncExternalStore } from "react";
import { ru, type Message } from "./locales";

export type Language = "en" | "ru";
const STORAGE_KEY = "tasktrack-language";
const listeners = new Set<() => void>();

export function resolveLanguage(saved: string | null, systemLanguage: string): Language {
  if (saved === "ru" || saved === "en") return saved;
  return systemLanguage.toLowerCase().startsWith("ru") ? "ru" : "en";
}

function initialLanguage(): Language {
  let saved: string | null = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
  return resolveLanguage(saved, typeof navigator === "undefined" ? "en" : navigator.language);
}

let language = initialLanguage();
// index.html ships with a fixed lang; sync it before any screen (including Loading…) renders.
if (typeof document !== "undefined") document.documentElement.lang = language;
export function getLanguage(): Language { return language; }

export function setLanguage(next: Language) {
  if (next !== "en" && next !== "ru") return;
  language = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep the selection for this session. */ }
  listeners.forEach((listener) => listener());
}

export function translate(message: Message, values: Record<string, string | number> = {}, locale = language): string {
  const text = locale === "ru" ? ru[message] : message === "{count} tasks (few)" ? "{count} tasks" : message;
  return text.replace(/\{(\w+)\}/g, (placeholder, key: string) => String(values[key] ?? placeholder));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  const t = useCallback((message: Message, values?: Record<string, string | number>) => translate(message, values, locale), [locale]);
  return { t, locale, setLanguage };
}

export function formatTaskCount(count: number, locale: Language): string {
  const form = new Intl.PluralRules(locale).select(count);
  return translate(form === "one" ? "{count} task" : form === "few" ? "{count} tasks (few)" : "{count} tasks", { count }, locale);
}

