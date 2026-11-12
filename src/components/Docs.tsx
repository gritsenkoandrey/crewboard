import { translate, useI18n } from "../i18n";
import type { Message } from "../locales";
import Icon from "./Icon";
import { forwardRef, useImperativeHandle, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { getDocument, saveDocument } from "../api";
import { handleMarkdownClick, renderMarkdown } from "../markdown";
import { registerFlusher, trackSave } from "../saveTracker";
import ConfirmDialog from "./ConfirmDialog";
import MarkdownEditor from "./MarkdownEditor";

type Mode = "view" | "split" | "edit";
type SaveStatus = "saved" | "pending" | "saving" | "error";

const MODES: { id: Mode; label: Message }[] = [
  { id: "view", label: "View" },
  { id: "split", label: "Side by side" },
  { id: "edit", label: "Editor" },
];

const MODE_KEY = "docs-mode";
const AUTOSAVE_MS = 500;

function loadMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "view" || saved === "split" || saved === "edit") return saved;
  } catch {
    // localStorage is unavailable; use the default mode.
  }
  return "split";
}

export interface DocsHandle { flush: () => Promise<boolean> }
const Docs = forwardRef<DocsHandle, { projectId: string; documentId: string; onSeen: (id: string, revision: string) => void }>(function Docs({ projectId, documentId, onSeen }, ref) {
  const { t } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [externalUpdate, setExternalUpdate] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const conflict = useRef(false);
  const writes = useRef(0);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const [dir, setDir] = useState("");
  const [mode, setModeState] = useState<Mode>(loadMode);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);

  // Keep the latest and saved text in refs so edits can also be saved when the tab closes.
  const latest = useRef<string | null>(null);
  const saved = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const submitted = useRef<string | null>(null);

  const refresh = useCallback(async (force = false, alive: () => boolean = () => true) => {
    if (writes.current > 0) return;
    const before = saved.current;
    try {
      const content = await getDocument(projectId, documentId);
      if (!alive() || writes.current > 0 || saved.current !== before) return;
      if (!force && latest.current !== null && latest.current !== saved.current && content.text !== saved.current && content.text !== latest.current) {
        conflict.current = true; setHasConflict(true);
        window.clearTimeout(timer.current);
        return;
      }
      if (force || latest.current === null || content.text !== saved.current) {
        const wasLoaded = latest.current !== null;
        latest.current = saved.current = submitted.current = content.text;
        setText(content.text); setDir(content.dir); setStatus("saved"); setError(null);
        setEditorVersion((v) => v + 1);
        if (wasLoaded && !force) setExternalUpdate(true);
      }
      conflict.current = false; setHasConflict(false);
      onSeenRef.current(documentId, content.revision);
    } catch (e) {
      if (alive()) setError(translate("File is unavailable: {error}", { error: String(e) }));
    }
  }, [projectId, documentId]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refresh(false, () => !cancelled);
      if (!cancelled) pollTimer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(pollTimer); };
  }, [refresh]);

  const flush = useCallback((): Promise<boolean> => {
    window.clearTimeout(timer.current);
    if (conflict.current) return Promise.resolve(false);
    const value = latest.current;
    if (value === null || value === submitted.current) return queue.current;
    submitted.current = value;
    setStatus("saving");
    writes.current += 1;
    queue.current = trackSave(queue.current.then(async () => {
      try {
        const revision = await saveDocument(projectId, documentId, value, saved.current ?? "");
        onSeenRef.current(documentId, revision);
        saved.current = value;
        setError(null);
        setStatus(latest.current === value ? "saved" : "pending");
        return true;
      } catch (e) {
        submitted.current = null;
        setStatus("error");
        setError(String(e));
        if (String(e).includes("by another editor")) { conflict.current = true; setHasConflict(true); }
        return false;
      } finally { writes.current -= 1; }
    }));
    return queue.current;
  }, [projectId, documentId]);

  useImperativeHandle(ref, () => ({ flush: async () => {
    do { if (!await flush()) return false; } while (latest.current !== saved.current);
    return true;
  } }), [flush]);

  // Flush unsaved edits immediately when leaving the tab or project, or closing the window.
  useEffect(() => {
    const unregister = registerFlusher(() => { void flush(); });
    return () => {
      unregister();
      flush();
    };
  }, [flush]);

  function onChange(value: string) {
    latest.current = value;
    setText(value);
    setStatus("pending");
    window.clearTimeout(timer.current);
    if (!conflict.current) timer.current = window.setTimeout(flush, AUTOSAVE_MS);
  }

  function setMode(next: Mode) {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Failure to persist the mode is nonfatal.
    }
  }

  // Defer the preview to keep typing responsive in large documents.
  const deferredText = useDeferredValue(text);
  const html = useMemo(() => (deferredText === null ? "" : renderMarkdown(deferredText, dir)), [deferredText, dir]);

  if (text === null) {
    return error ? <div className="docs-load-error"><p className="error">{error}</p><button className="btn" onClick={() => void refresh()}>{t("Retry")}</button><p className="muted small">{t("If the file was moved, select its new location from the tab's «⋯» menu.")}</p></div> : <div className="muted">{t("Loading…")}</div>;
  }

  const isEmpty = text.trim() === "";

  return (
    <div className={`docs docs-${mode}`}>
      <div className="docs-toolbar">
        <div className="segmented">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? "active" : ""} onClick={() => setMode(m.id)}>
              {t(m.label)}
            </button>
          ))}
        </div>
        <span className={`save-status ${status}`}>
          {status === "saved" && t("Saved")}
          {status === "pending" && t("Modified")}
          {status === "saving" && t("Saving…")}
          {status === "error" && t("Not saved")}
        </span>
      </div>

      {externalUpdate && !hasConflict && <div className="document-update-notice" role="status">
        <span>{t("Updated from file")}</span><button className="icon-btn" aria-label={t("Dismiss update notification")} onClick={() => setExternalUpdate(false)}><Icon name="close" /></button>
      </div>}
      {hasConflict && <div className="document-conflict" role="alert">
        <span>{t("The file was changed externally. Your unsaved edits are preserved in the editor; autosave is paused.")}</span>
        <div>
          <button className="btn small-btn" onClick={() => { void navigator.clipboard.writeText(latest.current ?? "").catch((e) => setError(t("Failed to copy text: {error}", { error: String(e) }))); }}>{t("Copy my edits")}</button>
          <button className="btn small-btn" onClick={() => setReloadConfirm(true)}>{t("Load from disk")}</button>
        </div>
      </div>}
      {reloadConfirm && <ConfirmDialog title={t("Load version from disk?")} confirmLabel={t("Load")} danger
        onCancel={() => setReloadConfirm(false)} onConfirm={() => { setReloadConfirm(false); void refresh(true); }}>
        <p>{t("Unsaved edits in the editor will be replaced with the file contents. Copy them first if you want to keep them.")}</p>
      </ConfirmDialog>}
      {error && (
        <div className="error-bar docs-error">
          <span>{error}</span>
          <button className="icon-btn" title={t("Close")} onClick={() => setError(null)}>
                <Icon name="close" />
              </button>
        </div>
      )}

      <div className="docs-body">
        {mode !== "view" && (
          <div className="docs-pane editor-pane">
            <MarkdownEditor key={documentId + ":" + editorVersion} initialText={text} onChange={onChange} onSave={flush} />
          </div>
        )}
        {mode !== "edit" && (
          <div className="docs-pane preview-pane">
            {isEmpty ? (
              <div className="docs-empty muted">
                <p>{t("This document is empty.")}</p>
                {mode === "view" && (
                  <button className="btn" onClick={() => setMode("split")}>
                    {t("Start writing")}</button>
                )}
              </div>
            ) : (
              <article className="markdown" onClick={(e) => handleMarkdownClick(e, setError)} dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
});
export default Docs;
