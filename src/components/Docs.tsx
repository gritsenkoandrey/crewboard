import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { getReadme, saveReadme } from "../api";
import { handleMarkdownClick, renderMarkdown } from "../markdown";
import { registerFlusher, trackSave } from "../saveTracker";
import MarkdownEditor from "./MarkdownEditor";

type Mode = "view" | "split" | "edit";
type SaveStatus = "saved" | "pending" | "saving" | "error";

const MODES: { id: Mode; label: string }[] = [
  { id: "view", label: "Просмотр" },
  { id: "split", label: "Рядом" },
  { id: "edit", label: "Редактор" },
];

const MODE_KEY = "docs-mode";
const AUTOSAVE_MS = 500;

function loadMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "view" || saved === "split" || saved === "edit") return saved;
  } catch {
    // localStorage недоступен — режим по умолчанию.
  }
  return "split";
}

export default function Docs({ projectId }: { projectId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [dir, setDir] = useState("");
  const [mode, setModeState] = useState<Mode>(loadMode);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);

  // Текст для сохранения и последний сохранённый — в ref, чтобы сохранить и при закрытии вкладки.
  const latest = useRef<string | null>(null);
  const saved = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    getReadme(projectId).then(
      (readme) => {
        if (cancelled) return;
        latest.current = saved.current = readme.text;
        setText(readme.text);
        setDir(readme.dir);
      },
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const value = latest.current;
    if (value === null || value === saved.current) return;
    saved.current = value;
    setStatus("saving");
    queue.current = trackSave(queue.current.then(() => saveReadme(projectId, value))).then(
        () => setStatus(latest.current === value ? "saved" : "pending"),
        (e) => {
          // Сохранение не прошло: следующая правка или Ctrl+S попробует снова.
          saved.current = null;
          setStatus("error");
          setError(`Не удалось сохранить документацию: ${e}`);
        },
      );
  }, [projectId]);

  // Уход со вкладки, из проекта или закрытие окна — сохраняем несохранённое сразу.
  useEffect(() => {
    const unregister = registerFlusher(flush);
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
    timer.current = window.setTimeout(flush, AUTOSAVE_MS);
  }

  function setMode(next: Mode) {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Не запомним режим — не страшно.
    }
  }

  // Превью отстаёт от набора на кадр, чтобы ввод не тормозил на больших документах.
  const deferredText = useDeferredValue(text);
  const html = useMemo(() => (deferredText === null ? "" : renderMarkdown(deferredText, dir)), [deferredText, dir]);

  if (text === null) {
    return error ? <div className="error">{error}</div> : <div className="muted">Загрузка…</div>;
  }

  const isEmpty = text.trim() === "";

  return (
    <div className={`docs docs-${mode}`}>
      <div className="docs-toolbar">
        <div className="segmented">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? "active" : ""} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <span className={`save-status ${status}`}>
          {status === "saved" && "Сохранено"}
          {status === "pending" && "Изменено"}
          {status === "saving" && "Сохранение…"}
          {status === "error" && "Не сохранено"}
        </span>
      </div>

      {error && (
        <div className="error-bar docs-error">
          <span>{error}</span>
          <button className="icon-btn" title="Закрыть" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      <div className="docs-body">
        {mode !== "view" && (
          <div className="docs-pane editor-pane">
            <MarkdownEditor key={projectId} initialText={text} onChange={onChange} onSave={flush} />
          </div>
        )}
        {mode !== "edit" && (
          <div className="docs-pane preview-pane">
            {isEmpty ? (
              <div className="docs-empty muted">
                <p>Документация пока пустая.</p>
                {mode === "view" && (
                  <button className="btn" onClick={() => setMode("split")}>
                    Начать писать
                  </button>
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
}
