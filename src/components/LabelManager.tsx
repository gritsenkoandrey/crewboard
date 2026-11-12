import { formatTaskCount, useI18n } from "../i18n";
import Icon from "./Icon";
import { useEffect, useRef, useState } from "react";
import { LABEL_COLORS, LABEL_NAME_MAX, labelStyle, nextLabelColor } from "../labels";
import type { Label } from "../types";

interface Props {
  labels: Label[];
  usage: Map<string, number>;
  onCreate: (name: string, color?: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<Label, "name" | "color">>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}
export default function LabelManager({ labels, usage, onCreate, onUpdate, onDelete, onClose }: Props) {
  const { t, locale } = useI18n();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const newInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  function create() {
    const name = newName.trim();
    if (!name || labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) return;
    onCreate(name, newColor || undefined);
    setNewName("");
    setNewColor("");
    newInput.current?.focus();
  }
  const duplicate = labels.some((l) => l.name.toLowerCase() === newName.trim().toLowerCase());

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div ref={dialog} tabIndex={-1} className="dialog label-manager" role="dialog" aria-modal="true"
        aria-labelledby="label-manager-title" aria-describedby="label-manager-description"
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            if (confirmDelete) setConfirmDelete(null); else onClose();
          }
          if (e.key === "Tab") {
            const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
            if (!elements?.length) return;
            const first = elements[0], last = elements[elements.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }}>
        <header className="label-manager-heading">
          <div>
            <h2 id="label-manager-title">{t("Project labels")}</h2>
            <p id="label-manager-description" className="muted">{t("Organize and filter tasks")}</p>
          </div>
          <button className="icon-btn" title={t("Close (Esc)")} aria-label={t("Close labels")} onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="label-rows">
          {labels.length === 0 && <p className="label-empty-state muted">{t("No labels yet. Create the first one below.")}</p>}
          {labels.map((label) => {
            const used = usage.get(label.id) ?? 0;
            return (
              <div key={label.id} className="label-entry">
                <div className="label-row">
                  <LabelColorPicker color={label.color} name={t("Label color: {name}", { name: label.name })} onChange={(color) => onUpdate(label.id, { color })} />
                  <LabelNameInput name={label.name}
                    taken={(n) => labels.some((l) => l.id !== label.id && l.name.toLowerCase() === n.toLowerCase())}
                    onRename={(name) => onUpdate(label.id, { name })} />
                  <span className="muted label-usage" title={t("Including archived tasks")}>{formatTaskCount(used, locale)}</span>
                  <button className="icon-btn label-delete danger-hover" title={t("Delete label “{name}”", { name: label.name })}
                    aria-label={t("Delete label “{name}”", { name: label.name })}
                    onClick={() => used ? setConfirmDelete(label.id) : onDelete(label.id)}><Icon name="trash" /></button>
                </div>
                {confirmDelete === label.id && (
                  <div className="label-delete-confirm">
                    <p className="muted">{t("The label will be removed from all {count} tasks. The tasks will be kept.", { count: used })}</p>
                    <div className="label-confirm">
                      <button className="btn danger small-btn" onClick={() => { onDelete(label.id); setConfirmDelete(null); }}>{t("Delete label")}</button>
                      <button className="btn small-btn" onClick={() => setConfirmDelete(null)}>{t("Cancel")}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="label-create-section">
          <div className="label-create">
            <LabelColorPicker color={newColor || nextLabelColor(labels)} name={t("New label color")} onChange={setNewColor} />
            <input ref={newInput} className="inline-input" aria-label={t("New label name")} value={newName}
              maxLength={LABEL_NAME_MAX} placeholder={t("New label…")} aria-invalid={duplicate || undefined}
              onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); create(); }
              }} />
            <button className="btn primary label-create-button" title={t("Add label")} aria-label={t("Add label")}
              disabled={!newName.trim() || duplicate} onClick={create}><Icon name="plus" /></button>
          </div>
          {duplicate && newName.trim() && <p className="label-duplicate" role="status">{t("A label with this name already exists.")}</p>}
          <p className="label-autosave muted">{t("Changes are saved automatically")}</p>
        </div>
      </div>
    </div>
  );
}

function LabelColorPicker({ color, name, onChange }: { color: string; name: string; onChange: (color: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="color-cell" onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
    }} onKeyDown={(e) => {
      if (e.key === "Escape" && open) {
        e.stopPropagation();
        setOpen(false);
      }
    }}>
      <button type="button" className="color-swatch" style={labelStyle(color)}
        title={name} aria-label={name} aria-expanded={open}
        onClick={() => setOpen(!open)} />
      {open && (
        <div className="color-palette" role="group" aria-label={t("Choose color")}>
          {LABEL_COLORS.map((c) => (
            <button type="button" key={c.key}
              className={`color-swatch ${c.key === color ? "current" : ""}`}
              style={labelStyle(c.key)} title={t(c.name)} aria-label={t(c.name)}
              aria-pressed={c.key === color}
              onClick={() => { onChange(c.key); setOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Inline label name editor; saves on blur or Enter. */
function LabelNameInput({
  name,
  taken,
  onRename,
}: {
  name: string;
  taken: (name: string) => boolean;
  onRename: (name: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);

  function commit() {
    const trimmed = value.trim();
    // Revert empty or duplicate names instead of saving them.
    if (!trimmed || taken(trimmed)) setValue(name);
    else if (trimmed !== name) onRename(trimmed);
  }

  return (
    <input
      className="label-name-input"
      aria-label={t("Label name: {name}", { name })}
      value={value}
      maxLength={LABEL_NAME_MAX}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
      }}
    />
  );
}
