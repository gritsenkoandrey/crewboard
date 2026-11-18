import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { searchTasks, type SearchTask } from "../taskSearch";
import type { Task } from "../types";
import Icon from "./Icon";

interface Props {
  tasks: SearchTask[];
  onOpen: (task: Task) => void;
  onClose: () => void;
}

export default function TaskSearch({ tasks, onOpen, onClose }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const listId = useId();
  const matches = useMemo(() => searchTasks(tasks, query), [tasks, query]);
  const results = matches.slice(0, 50);
  const selected = Math.min(activeIndex, results.length - 1);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    list.current?.querySelectorAll<HTMLElement>('[role="option"]')[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected, query, results.length]);

  return <div className="overlay" onMouseDown={onClose}>
    <div className="dialog task-search-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); onClose(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); e.stopPropagation(); input.current?.focus(); input.current?.select(); }
        if (e.key === "Tab") {
          if (e.shiftKey && document.activeElement === closeButton.current) { e.preventDefault(); input.current?.focus(); }
          else if (!e.shiftKey && document.activeElement === input.current) { e.preventDefault(); closeButton.current?.focus(); }
        }
      }}>
      <header className="task-search-heading">
        <h2 id={titleId}>{t("Search tasks")}</h2>
        <button ref={closeButton} type="button" className="icon-btn" aria-label={t("Close task search")} title={t("Close (Esc)")} onClick={onClose}><Icon name="close" /></button>
      </header>
      <input ref={input} className="inline-input task-search-input" type="search" role="combobox" aria-label={t("Task code or title")}
        aria-autocomplete="list" aria-expanded={true} aria-controls={listId} aria-activedescendant={selected >= 0 ? `${listId}-${results[selected].task.id}` : undefined}
        placeholder={t("Task code or title…")} value={query} onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(results.length ? (selected + 1) % results.length : 0); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(results.length ? (selected - 1 + results.length) % results.length : 0); }
          else if (e.key === "Enter" && selected >= 0) { e.preventDefault(); onOpen(results[selected].task); }
        }} />
      <p className="muted task-search-hint">{t("Search all project tasks, including archived tasks and tasks hidden by filters.")}</p>
      <div ref={list} id={listId} className="task-search-results" role="listbox" aria-label={t("Search results")}>
        {results.map(({ task, code, status, releaseName }, index) => <button key={task.id} id={`${listId}-${task.id}`} type="button" role="option" tabIndex={-1}
          className="task-search-result" aria-selected={index === selected} onMouseDown={(e) => e.preventDefault()} onClick={() => onOpen(task)}>
          <span className="task-search-result-meta"><span className="task-code">{code}</span><span>{status}</span>{releaseName && <span>{releaseName}</span>}{task.archived && <span className="task-search-archived"><Icon name="archive" />{t("Archive")}</span>}</span>
          <span className="task-search-result-title">{task.title}</span>
        </button>)}
      </div>
      {results.length === 0 && <p className="muted task-search-empty" role="status">{t("No tasks found")}</p>}
      <footer className="muted task-search-footer">
        <span role="status">{matches.length > results.length ? t("Showing {shown} of {total} — refine your search", { shown: results.length, total: matches.length }) : t("Tasks found: {count}", { count: matches.length })}</span>
        <span>{t("↑ ↓ to select · Enter to open · Esc to close")}</span>
      </footer>
    </div>
  </div>;
}
