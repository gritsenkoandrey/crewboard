import { useRef, useState, type FormEvent } from "react";
import type { DataDirInfo } from "../api";
import { useI18n } from "../i18n";
import Icon from "./Icon";
import LanguageSwitcher from "./LanguageSwitcher";
import AmbientBackground from "./AmbientBackground";
import "./WelcomeScreen.css";

type Props = {
  info: DataDirInfo;
  error?: string | null;
  onChooseFolder: () => Promise<void>;
} & ({ mode: "folder" } | { mode: "project"; onCreateProject: (name: string) => Promise<void> });

export default function WelcomeScreen(props: Props) {
  const { t } = useI18n();
  const working = useRef(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<"folder" | "create" | null>(null);
  const busy = pending !== null;
  const [actionError, setActionError] = useState<string | null>(null);

  async function perform(action: () => Promise<void>, kind: "folder" | "create") {
    if (working.current) return;
    working.current = true;
    setPending(kind);
    setActionError(null);
    try { await action(); }
    catch (error) { setActionError(String(error)); }
    finally { working.current = false; setPending(null); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (props.mode === "project" && trimmed) {
      void perform(() => props.onCreateProject(trimmed), "create");
    }
  }

  return (
    <div className={`welcome-screen welcome-screen--${props.mode}`}>
      <AmbientBackground />
      {props.mode === "folder" && <div className="welcome-toolbar">
        <span className="welcome-wordmark">Crewboard</span><LanguageSwitcher />
      </div>}
      <div className="welcome-content">
        <section className="welcome-card" aria-labelledby="welcome-title" aria-busy={busy}>
          <div className="welcome-emblem" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect x="5" y="8" width="6" height="17" rx="2" fill="currentColor" />
              <rect x="13" y="5" width="6" height="15" rx="2" fill="currentColor" opacity=".8" />
              <rect x="21" y="11" width="6" height="14" rx="2" fill="currentColor" opacity=".6" />
            </svg>
          </div>
          <p className="welcome-eyebrow">{t("Welcome to Crewboard")}</p>
          <h1 id="welcome-title">{t(props.mode === "folder" ? "Your workspace starts here" : "Create your first project")}</h1>
          <p className="welcome-description">{t(props.mode === "folder"
            ? "A space for your projects, tasks, and documents. Choose a folder to get started."
            : "Start with a name. Your tasks and documents will have a place of their own.")}</p>

          {props.mode === "folder" ? <>
            {props.info.missing && <div className="welcome-warning" role="status">
              <strong>{t("Data folder is unavailable:")}</strong>
              <code>{props.info.path}</code>
              <span>{t("Connect the drive or select another folder.")}</span>
            </div>}
            <button type="button" className="btn primary welcome-primary" disabled={busy}
              onClick={() => void perform(props.onChooseFolder, "folder")}>
              <Icon name="folder" width="18" height="18" />
              {t(busy ? "Opening folder picker…" : "Choose a project folder")}
              {!busy && <Icon name="chevron" />}
            </button>
            <p className="welcome-hint">{t("Existing projects in this folder will be loaded automatically.")}</p>
          </> : <form className="welcome-form" onSubmit={submit}>
            <label htmlFor="first-project-name">{t("Project name")}</label>
            <input id="first-project-name" className="welcome-input" value={name} maxLength={200}
              placeholder={t("For example, My next idea")} disabled={busy} autoComplete="off" autoFocus
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
            <button type="submit" className="btn primary welcome-primary" disabled={busy || !name.trim()}>
              <Icon name="plus" width="18" height="18" />
              {t(pending === "create" ? "Creating project…" : "Create project")}
              {!busy && <Icon name="chevron" />}
            </button>
            <div className="welcome-folder">
              <Icon name="folder" />
              <span title={props.info.path ?? ""}>{props.info.path}</span>
              <button type="button" className="link-btn" disabled={busy}
                onClick={() => void perform(props.onChooseFolder, "folder")}>{t("Change")}</button>
            </div>
          </form>}
          {(actionError || props.error) && <p className="welcome-error" role="alert">{actionError || props.error}</p>}
        </section>
        <p className="welcome-footnote"><Icon name="folder" />{t("Your projects stay in the folder you choose.")}</p>
      </div>
    </div>
  );
}
