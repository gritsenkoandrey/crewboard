import { useI18n } from "../i18n";
import { useEffect, useRef } from "react";
import type { ColumnId, Label, Task } from "../types";
import { LabelPill } from "../labels";
import { taskCode } from "../taskMetadata";
import Icon from "./Icon";

interface Props {
  tasks: { task: Task; column: ColumnId; status: string }[];
  prefix: string;
  labels: Label[];
  onRestore: (id: string) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}
export default function TaskArchive({ tasks, prefix, labels, onRestore, onOpen, onClose }: Props) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div ref={dialog} tabIndex={-1} className="dialog archive-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-title"
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); onClose(); }
          if (e.key === "Tab") {
            const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button");
            if (!buttons?.length) return;
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }}>
        <header className="archive-heading">
          <h2 id="archive-title">{t("Archive")} <span className="muted">{tasks.length}</span></h2>
          <button className="icon-btn" title={t("Close")} aria-label={t("Close archive")} onClick={onClose}><Icon name="close" /></button>
        </header>
        {tasks.length === 0 ? <p className="muted archive-empty">{t("The archive is empty. Archive tasks from the task panel.")}</p> : (
          <div className="archive-list">
            {tasks.map(({ task, status }) => (
              <div className="archive-row" key={task.id}>
                <div className="archive-task">
                  <span className="task-code">{taskCode(prefix, task.number)} · {status}</span>
                  <button className="archive-task-title" onClick={() => onOpen(task.id)}>{task.title}</button>
                  <div className="task-labels">{labels.filter((label) => task.labels?.includes(label.id)).map((label) => <LabelPill key={label.id} label={label} />)}</div>
                </div>
                <button className="btn archive-restore" onClick={() => onRestore(task.id)}><Icon name="restore" />{t("Restore")}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
