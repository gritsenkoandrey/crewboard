import { useI18n } from "./i18n";
import AgentSettings from "./components/AgentSettings";
import Icon from "./components/Icon";
import LanguageSwitcher from "./components/LanguageSwitcher";
import { useEffect, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { flushAll, trackSave } from "./saveTracker";
import {
  createProject,
  deleteProject,
  restoreDeletedProject,
  getDataDir,
  listProjects,
  moveProject,
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
import WelcomeScreen from "./components/WelcomeScreen";
import AmbientBackground from "./components/AmbientBackground";
import type { Project } from "./types";

function applyProjectOrder(projects: Project[], ids: string[]): Project[] {
  const positions = new Map(ids.map((id, index) => [id, index]));
  return [...projects].sort((a, b) => (positions.get(a.id) ?? -1) - (positions.get(b.id) ?? -1));
}

export default function App() {
  const { t } = useI18n();
  const [agentSettings, setAgentSettings] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [restoringProject, setRestoringProject] = useState(false);
  const [reorderingProjects, setReorderingProjects] = useState(false);
  const [deletedProject, setDeletedProject] = useState<{ token: string; name: string } | null>(null);
  const projectOperation = useRef(false);
  const [info, setInfo] = useState<DataDirInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectList, setProjectList] = useState<{ path: string | null; status: "loading" | "loaded" | "error" }>({ path: null, status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = !!info?.path && !info.missing;
  const projectBusy = deletingProject || restoringProject;

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
    const path = info?.path;
    if (!ready || !path) return;
    let cancelled = false;
    setProjectList({ path, status: "loading" });
    listProjects().then((loaded) => {
      if (cancelled) return;
      setProjects(loaded);
      setProjectList({ path, status: "loaded" });
    }, (error) => {
      if (cancelled) return;
      setError(String(error));
      setProjectList({ path, status: "error" });
    });
    return () => { cancelled = true; };
  }, [ready, info?.path, reloadKey]);

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
    await run(async () => {
      const path = await pickFolder(info?.path ?? undefined);
      if (!path) return;
      setInfo(await setDataDir(path));
      setOpenId(null);
      setDeletedProject(null);
    });
  }

  async function addProject(name: string, open = false) {
    const created = await createProject(name);
    setProjects((list) => [created, ...list]);
    if (open) setOpenId(created.id);
  }

  function replaceProject(updated: Project) {
    setProjects((list) => list.map((p) => (p.id === updated.id ? updated : p)));
  }

  async function reorderProjects(id: string, targetId: string, before: boolean) {
    if (projectOperation.current) return;
    const previousOrder = projects.map((project) => project.id);
    const nextOrder = arrayMove(previousOrder, previousOrder.indexOf(id), previousOrder.indexOf(targetId));
    projectOperation.current = true;
    setReorderingProjects(true);
    setError(null);
    setProjects((list) => applyProjectOrder(list, nextOrder));
    try {
      const order = await moveProject(id, targetId, before);
      setProjects((list) => applyProjectOrder(list, order));
    } catch (e) {
      setProjects((list) => applyProjectOrder(list, previousOrder));
      setError(String(e));
    } finally {
      projectOperation.current = false;
      setReorderingProjects(false);
    }
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
      const order = (await listProjects()).map((project) => project.id);
      setProjects((list) => applyProjectOrder(list, order));
    } catch (e) { setError(String(e)); }
    finally { projectOperation.current = false; setRestoringProject(false); }
  }

  if (!info) {
    return <div className="center muted">{error ?? t("Loading…")}</div>;
  }

  if (!ready) {
    return <WelcomeScreen mode="folder" info={info} error={error} onChooseFolder={chooseFolder} />;
  }

  const projectsLoaded = projectList.path === info.path && projectList.status === "loaded";
  const projectsFailed = projectList.path === info.path && projectList.status === "error";
  const openProject = projectsLoaded ? projects.find((p) => p.id === openId) ?? null : null;
  const showWelcome = projectsLoaded && projects.length === 0;
  const showProjectLibrary = projectsLoaded && !showWelcome && !openProject;

  return (
    <div className={`app${showProjectLibrary ? " app--project-library" : ""}`} aria-busy={projectBusy}>
      {showProjectLibrary && <AmbientBackground variant="projects" />}
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
          <button className="topbar-action" title={t("Change data folder")} aria-label={t("Change data folder")} onClick={chooseFolder} disabled={reorderingProjects}>
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
      <main className={`content${showWelcome ? " content-welcome" : ""}`} inert={projectBusy}>
        {!projectsLoaded ? <div className="center muted">
          {projectsFailed ? <div className="project-load-error">
            <p>{t("Could not load projects.")}</p>
            <button className="btn" onClick={() => { setError(null); setReloadKey((key) => key + 1); }}>{t("Try again")}</button>
          </div> : t("Loading…")}
        </div> : showWelcome ? (
          <WelcomeScreen mode="project" info={info} onChooseFolder={chooseFolder}
            onCreateProject={(name) => addProject(name, true)} />
        ) : openProject ? (
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
            reordering={reorderingProjects}
            onReorder={(id, targetId, before) => trackSave(reorderProjects(id, targetId, before))}
            onOpen={(id) => { setDeletedProject(null); setOpenId(id); }}
            onCreate={(name) =>
              run(() => addProject(name))
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
        <button type="button" className="link-btn" disabled={projectBusy || reorderingProjects} onClick={() => void trackSave(undoProjectDeletion())}>{t(restoringProject ? "Undoing…" : "Undo")}</button>
        <button type="button" className="icon-btn" disabled={projectBusy} aria-label={t("Dismiss notification")} onClick={() => setDeletedProject(null)}><Icon name="close" /></button>
      </div>}
    </div>
  );
}
