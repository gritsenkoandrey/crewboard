import { useI18n } from "./i18n";
import AgentSettings from "./components/AgentSettings";
import Icon from "./components/Icon";
import LanguageSwitcher from "./components/LanguageSwitcher";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { flushAll, trackSave } from "./saveTracker";
import {
  createProject,
  deleteProject,
  restoreDeletedProject,
  getDataDir,
  listProjects,
  pickFolder,
  pickImage,
  removeCover,
  renameProject,
  setCover,
  setDataDir,
  type DataDirInfo,
} from "./api";
import ProjectList from "./components/ProjectList";
import ProjectPage from "./components/ProjectPage";
import type { Project } from "./types";

export default function App() {
  const { t } = useI18n();
  const [agentSettings, setAgentSettings] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [restoringProject, setRestoringProject] = useState(false);
  const [deletedProject, setDeletedProject] = useState<{ token: string; name: string } | null>(null);
  const projectOperation = useRef(false);
  const [info, setInfo] = useState<DataDirInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = !!info?.path && !info.missing;
  const projectBusy = deletingProject || restoringProject;

  const reload = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    getDataDir().then(setInfo, (e) => setError(String(e)));
  }, []);

  // Flush pending and unfinished saves before closing the window.
  // Tauri waits for the handler to finish before closing the window.
  useEffect(() => {
    let unlisten: Promise<(() => void) | undefined>;
    try {
      unlisten = getCurrentWindow()
        .onCloseRequested(() => flushAll())
        .catch(() => undefined);
    } catch {
      // Outside a Tauri window (for example, in a browser), there is no window event to subscribe to.
      return;
    }
    return () => {
      void unlisten.then((fn) => fn?.());
    };
  }, []);

  // Reload the list whenever the data folder changes.
  useEffect(() => {
    if (ready) void reload();
  }, [ready, info?.path, reload]);

  /** Runs an action and displays any error in the top bar. */
  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseFolder() {
    setError(null);
    const path = await pickFolder(info?.path ?? undefined);
    if (!path) return;
    await run(async () => {
      setInfo(await setDataDir(path));
      setOpenId(null);
      setDeletedProject(null);
    });
  }

  function replaceProject(updated: Project) {
    setProjects((list) => list.map((p) => (p.id === updated.id ? updated : p)));
  }

  function changeCover(id: string) {
    return run(async () => {
      const source = await pickImage();
      if (source) replaceProject(await setCover(id, source));
    });
  }

  function deleteCover(id: string) {
    return run(async () => replaceProject(await removeCover(id)));
  }

  async function removeProject(id: string) {
    if (projectOperation.current) return;
    projectOperation.current = true;
    setDeletingProject(true);
    setError(null);
    const name = projects.find((project) => project.id === id)?.name ?? id;
    try {
      await flushAll();
      const receipt = await deleteProject(id);
      setProjects((list) => list.filter((project) => project.id !== id));
      setDeletedProject({ token: receipt.token, name });
    } catch (e) { setError(String(e)); }
    finally { projectOperation.current = false; setDeletingProject(false); }
  }

  async function undoProjectDeletion() {
    if (!deletedProject || projectOperation.current) return;
    projectOperation.current = true;
    setRestoringProject(true);
    setError(null);
    try {
      const restored = await restoreDeletedProject(deletedProject.token);
      setProjects((list) => [restored, ...list.filter((project) => project.id !== restored.id)]);
      setDeletedProject(null);
    } catch (e) { setError(String(e)); }
    finally { projectOperation.current = false; setRestoringProject(false); }
  }

  if (!info) {
    return <div className="center muted">{error ?? t("Loading…")}</div>;
  }

  if (!ready) {
    return <SetupScreen info={info} error={error} onChoose={chooseFolder} />;
  }

  const openProject = projects.find((p) => p.id === openId) ?? null;

  return (
    <div className="app" aria-busy={projectBusy}>
      <header className="topbar" inert={projectBusy}>
        <button className="logo" onClick={() => setOpenId(null)}>
          Crewboard
        </button>
        <div className="data-dir muted" title={info.path ?? ""}>
          {info.path}
        </div>
        <div className="topbar-actions">
          <LanguageSwitcher />
          <button className="topbar-action" title={t("Participants")} aria-label={t("Participants")}
            aria-haspopup="dialog" aria-expanded={agentSettings} onClick={() => setAgentSettings(true)}>
            <Icon name="users" />
            <span>{t("Participants")}</span>
          </button>
          <button className="topbar-action" title={t("Change data folder")} aria-label={t("Change data folder")} onClick={chooseFolder}>
            <Icon name="folder" />
            <span>{t("Change folder")}</span>
          </button>
        </div>
      </header>
      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button className="icon-btn" title={t("Close")} onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      {agentSettings && <AgentSettings onClose={() => setAgentSettings(false)} />}
      {deletingProject && <div className="project-deletion-status" role="status">{t("Moving project to the Recycle Bin…")}</div>}
      {restoringProject && <div className="project-deletion-status" role="status">{t("Restoring project…")}</div>}
      <main className="content" inert={projectBusy}>
        {openProject ? (
          <ProjectPage
            key={openProject.id}
            project={openProject}
            onBack={() => setOpenId(null)}
            onRename={(name) => run(async () => replaceProject(await renameProject(openProject.id, name)))}
            onChangeCover={() => changeCover(openProject.id)}
            onRemoveCover={() => deleteCover(openProject.id)}
          />
        ) : (
          <ProjectList
            projects={projects}
            onOpen={(id) => { setDeletedProject(null); setOpenId(id); }}
            onCreate={(name) =>
              run(async () => {
                const created = await createProject(name);
                setProjects((list) => [created, ...list]);
              })
            }
            onRename={(id, name) => run(async () => replaceProject(await renameProject(id, name)))}
            onChangeCover={changeCover}
            onRemoveCover={deleteCover}
            onDelete={(id) => trackSave(removeProject(id))}
          />
        )}
      </main>
      {deletedProject && <div className="archive-toast project-deletion-toast" role="status">
        <span>{t("Project “{name}” moved to the Recycle Bin", { name: deletedProject.name })}</span>
        <button type="button" className="link-btn" disabled={projectBusy} onClick={() => void trackSave(undoProjectDeletion())}>{t(restoringProject ? "Undoing…" : "Undo")}</button>
        <button type="button" className="icon-btn" disabled={projectBusy} aria-label={t("Dismiss notification")} onClick={() => setDeletedProject(null)}><Icon name="close" /></button>
      </div>}
    </div>
  );
}

function SetupScreen({ info, error, onChoose }: { info: DataDirInfo; error: string | null; onChoose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="center">
      <div className="setup">
        <div className="setup-language"><LanguageSwitcher /></div>
        <h1>Crewboard</h1>
        {info.missing ? (
          <p className="warning">
            {t("Data folder is unavailable:")}<br />
            <code>{info.path}</code>
            <br />
            {t("Connect the drive or select another folder.")}</p>
        ) : (
          <p>
            {t("Choose a folder for your projects. Use a separate drive or a backed-up folder to keep your data after reinstalling Windows.")}
          </p>
        )}
        <p className="muted">{t("Existing projects in this folder will be loaded automatically.")}</p>
        <button className="btn primary" onClick={onChoose}>
          {t("Choose folder")}</button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
