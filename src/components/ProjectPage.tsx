import { useI18n } from "../i18n";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Project } from "../types";
import { getSourceDir, setSourceDir, pickFolder, documentRevisions, linkDocument, unlinkDocument, pickMarkdown, listDocuments, createDocument, renameDocument, reorderDocuments, deleteDocument, type ProjectDocument } from "../api";
import Board from "./Board";
import Docs, { type DocsHandle } from "./Docs";
import InlineInput from "./InlineInput";
import ProjectCover from "./ProjectCover";
import Icon from "./Icon";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  project: Project;
  onBack: () => void;
  onRename: (name: string) => Promise<void>;
  onChangeCover: () => Promise<void>;
  onRemoveCover: () => Promise<void>;
}
export default function ProjectPage({ project, onBack, onRename, onChangeCover, onRemoveCover }: Props) {
  const { t } = useI18n();
  const [sourceDir, setSourceDirState] = useState<string | null>(project.sourceDir ?? null);
  useEffect(() => { void getSourceDir(project.id).then(setSourceDirState).catch(() => undefined); }, [project.id]);
  const [tab, setTab] = useState("board");
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDialog, setNameDialog] = useState<{ document?: ProjectDocument } | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const seenRevisions = useRef(new Map<string, string | null>());
  const [menu, setMenu] = useState<ProjectDocument | null>(null);
  const [deleting, setDeleting] = useState<ProjectDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editor = useRef<DocsHandle>(null);
  const working = useRef(false);
  const storageKey = "project-tab:" + project.dir;
  useEffect(() => {
    let cancelled = false;
    listDocuments(project.id).then((docs) => {
      if (cancelled) return;
      setDocuments(docs);
      let last = "board";
      try { last = localStorage.getItem(storageKey) ?? "board"; } catch { /* optional preference */ }
      setTab(docs.some((d) => d.id === last) ? last : "board");
      setLoaded(true);
    }, (e) => { if (!cancelled) { setError(String(e)); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [project.id, storageKey]);

  const markSeen = useCallback((id: string, revision: string) => {
    seenRevisions.current.set(id, revision);
    setChanged((old) => { const next = new Set(old); next.delete(id); return next; });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const revisions = await documentRevisions(project.id);
        if (cancelled) return;
        setChanged((old) => {
          const next = new Set(old);
          for (const entry of revisions) {
            if (entry.error) next.add(entry.id);
            if (!seenRevisions.current.has(entry.id)) seenRevisions.current.set(entry.id, entry.revision);
            else if (entry.revision !== seenRevisions.current.get(entry.id)) next.add(entry.id);
          }
          return next;
        });
      } catch { /* A temporarily unavailable data directory is retried. */ }
      if (!cancelled) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [project.id, loaded]);

  function connect(document?: ProjectDocument) {
    setAddMenu(false); setMenu(null);
    void run(async () => {
      if (!await saveBeforeLeaving()) return;
      const source = await pickMarkdown();
      if (!source) return;
      const docs = await linkDocument(project.id, source, document?.id);
      setDocuments(docs);
      if (!document) remember(docs[docs.length - 1].id);
    });
  }

  function remember(id: string) {
    setTab(id);
    try { localStorage.setItem(storageKey, id); } catch { /* optional preference */ }
  }
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(String(e)); }
    finally { working.current = false; setBusy(false); }
  }
  async function saveBeforeLeaving() {
    return !editor.current || await editor.current.flush();
  }
  function selectTab(id: string) {
    if (id === tab) return;
    setMenu(null);
    void run(async () => { if (await saveBeforeLeaving()) remember(id); });
  }
  async function leave() {
    await run(async () => { if (await saveBeforeLeaving()) onBack(); });
  }
  async function saveName(name: string) {
    await run(async () => {
      if (nameDialog?.document) {
        setDocuments(await renameDocument(project.id, nameDialog.document.id, name));
      } else {
        if (!await saveBeforeLeaving()) { setNameDialog(null); return; }
        const docs = await createDocument(project.id, name);
        setDocuments(docs);
        remember(docs[docs.length - 1].id);
      }
      setNameDialog(null);
    });
  }
  function moveDocument(document: ProjectDocument, direction: number) {
    setMenu(null);
    void run(async () => {
      const next = [...documents];
      const from = next.findIndex((d) => d.id === document.id), to = from + direction;
      if (from < 0 || to < 0 || to >= next.length) return;
      [next[from], next[to]] = [next[to], next[from]];
      setDocuments(await reorderDocuments(project.id, next.map((d) => d.id)));
    });
  }
  const activeDocument = documents.find((d) => d.id === tab);

  return (
    <div className="project-page">
      <div className="project-header">
        <div className="header-cover-wrap">
          <ProjectCover project={project} className="header-cover" />
          <div className="cover-actions">
            <button onClick={() => void onChangeCover()}>{project.coverPath ? t("Change") : t("Add cover")}</button>
            {project.coverPath && <button onClick={() => void onRemoveCover()}>{t("Remove cover")}</button>}
          </div>
        </div>
        <div className="project-header-main">
          <button className="link-btn" onClick={() => void leave()}>
            ← {t("All projects")}
          </button>
          {renaming ? (
            <InlineInput
              className="title-input"
              initial={project.name}
              onCommit={(name) => {
                setRenaming(false);
                void onRename(name);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <h1 className="project-title" title={t("Click to rename")} onClick={() => setRenaming(true)}>
              {project.name}
            </h1>
          )}
          <div className="project-source">
            <span className="muted small" title={sourceDir ?? t("Source folder for the agent")}>{sourceDir ? t("Sources: ") + sourceDir : t("Sources not selected")}</span>
            <button className="link-btn" disabled={busy} onClick={() => void run(async () => {
              const path = await pickFolder(sourceDir ?? undefined);
              if (path) setSourceDirState(await setSourceDir(project.id, path));
            })}>{sourceDir ? t("Change") : t("Choose folder")}</button>
          </div>
          <div className="document-tabs-row">
            <nav className="tabs document-tabs" aria-label={t("Project sections")}>
              <button className={tab === "board" ? "active" : ""} onClick={() => selectTab("board")} disabled={busy}>{t("Board")}</button>
              {documents.map((doc) => (
                <div key={doc.id} className={"document-tab " + (tab === doc.id ? "active" : "")}>
                  <button className={tab === doc.id ? "active document-tab-name" : "document-tab-name"}
                    title={doc.name + " · " + (doc.externalPath ?? doc.file)} onClick={() => selectTab(doc.id)} disabled={busy}>{doc.externalPath && <Icon name="link" />}<span>{doc.name}</span>{changed.has(doc.id) && <span className="document-change-dot" title={t("File changed")} aria-label={t("File changed")} />}</button>
                  <button className="document-tab-menu" title={t("Actions: {name}", { name: doc.name })} aria-label={t("Document actions: {name}", { name: doc.name })}
                    aria-expanded={menu?.id === doc.id} onClick={() => setMenu(menu?.id === doc.id ? null : doc)} disabled={busy}><Icon name="more" /></button>
                </div>
              ))}
            </nav>
            <button className="icon-btn document-add" title={t("Add document")} aria-label={t("Add document")} aria-expanded={addMenu}
              disabled={!loaded || busy} onClick={() => { setMenu(null); setAddMenu(!addMenu); }}><Icon name="plus" /></button>
          </div>
        </div>
      </div>
      {addMenu && <div className="document-actions document-add-options" onKeyDown={(e) => { if (e.key === "Escape") setAddMenu(false); }}>
        <button className="btn" onClick={() => { setAddMenu(false); setNameDialog({}); }}><Icon name="plus" /> {t("New document")}</button>
        <button className="btn" onClick={() => connect()}><Icon name="link" /> {t("Connect Markdown file…")}</button>
        <button className="icon-btn" aria-label={t("Close document options")} onClick={() => setAddMenu(false)}><Icon name="close" /></button>
      </div>}
      {menu && (
        <div className="document-actions" onKeyDown={(e) => { if (e.key === "Escape") setMenu(null); }}>
          <span className="muted document-actions-name">{menu.name}</span>
          <button className="btn small-btn" onClick={() => { setNameDialog({ document: menu }); setMenu(null); }}>{t("Rename")}</button>
          <button className="icon-btn" title={t("Move left")} aria-label={t("Move left")} disabled={documents[0]?.id === menu.id} onClick={() => moveDocument(menu, -1)}><Icon name="back" /></button>
          <button className="icon-btn" title={t("Move right")} aria-label={t("Move right")} disabled={documents[documents.length - 1]?.id === menu.id} onClick={() => moveDocument(menu, 1)}><Icon name="back" style={{ transform: "rotate(180deg)" }} /></button>
          {menu.externalPath && <>
            <button className="btn small-btn" onClick={() => void run(async () => { await revealItemInDir(menu.externalPath!); })}>{t("Show in folder")}</button>
            <button className="btn small-btn" onClick={() => connect(menu)}>{t("Choose another file")}</button>
          </>}
          <button className="icon-btn danger-hover" title={menu.externalPath ? t("Unlink from project") : t("Move to Recycle Bin")} aria-label={menu.externalPath ? t("Unlink from project") : t("Delete document")} onClick={() => { setDeleting(menu); setMenu(null); }}><Icon name={menu.externalPath ? "link" : "trash"} /></button>
          <button className="icon-btn" title={t("Close")} aria-label={t("Close document actions")} onClick={() => setMenu(null)}><Icon name="close" /></button>
        </div>
      )}
      {error && <div className="error-bar"><span>{error}</span><button className="icon-btn" aria-label={t("Dismiss error")} onClick={() => setError(null)}><Icon name="close" /></button></div>}
      <div className="tab-content" aria-busy={busy}>
        {!loaded ? <p className="muted">{t("Loading…")}</p> : activeDocument ? (
          <Docs ref={editor} key={project.id + ":" + activeDocument.id + ":" + (activeDocument.externalPath ?? "")} projectId={project.id} documentId={activeDocument.id} onSeen={markSeen} />
        ) : <Board projectId={project.id} projectDir={project.dir} />}
      </div>
      {nameDialog && <DocumentNameDialog initial={nameDialog.document?.name ?? ""} title={nameDialog.document ? t("Rename document") : t("New document")}
        busy={busy} error={error} onSubmit={saveName} onClose={() => { if (!busy) { setNameDialog(null); setError(null); } }} />}
      {deleting && <ConfirmDialog title={deleting.externalPath ? t("Unlink document?") : t("Delete document?")} confirmLabel={deleting.externalPath ? t("Unlink") : t("Recycle")} danger
        onCancel={() => setDeleting(null)} onConfirm={() => {
          const document = deleting;
          void run(async () => {
            if (!await saveBeforeLeaving()) { setDeleting(null); return; }
            const docs = document.externalPath ? await unlinkDocument(project.id, document.id) : await deleteDocument(project.id, document.id);
            if (tab === document.id) remember("board");
            setDocuments(docs); setDeleting(null);
          });
        }}><p>{deleting.externalPath ? t("The “{name}” tab will be removed from the project. The original file will stay in place.", { name: deleting.name }) : t("Document “{name}” will be moved to the Windows Recycle Bin. You can restore it from there.", { name: deleting.name })}</p></ConfirmDialog>}
    </div>
  );
}
function DocumentNameDialog({ initial, title, busy, error, onSubmit, onClose }: {
  initial: string; title: string; busy: boolean; error: string | null; onSubmit: (name: string) => Promise<void>; onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  function submit(e: FormEvent) { e.preventDefault(); if (name.trim() && !busy) void onSubmit(name.trim()); }
  return <div className="overlay" onMouseDown={onClose}>
    <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="document-name-title" onSubmit={submit}
      onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <h2 id="document-name-title">{title}</h2>
      <input ref={input} className="inline-input document-name-input" aria-label={t("Document name")} placeholder={t("For example, Marketing")} maxLength={100}
        value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="btn" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
        <button className="btn primary" type="submit" disabled={!name.trim() || busy}>{busy ? t("Saving…") : initial ? t("Save") : t("Create")}</button></div>
    </form>
  </div>;
}
