import { useEffect } from "react";
import { useI18n, type Language } from "../i18n";

export default function LanguageSwitcher() {
  const { t, locale, setLanguage } = useI18n();
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return (
    <div className="language-switcher" role="group" aria-label={t("Language")}>
      {(["ru", "en"] as Language[]).map((language) => (
        <button key={language} type="button" lang={language} aria-label={language === "ru" ? "Русский" : "English"}
          title={language === "ru" ? "Русский" : "English"} aria-pressed={locale === language}
          onClick={() => setLanguage(language)}>{language.toUpperCase()}</button>
      ))}
    </div>
  );
}
