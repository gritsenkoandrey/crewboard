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
const plural = new Intl.PluralRules("ru-RU");
function taskCount(count: number) {
  const form = plural.select(count);
  return count + " " + (form === "one" ? "задача" : form === "few" ? "задачи" : "задач");
}

export default function LabelManager({ labels, usage, onCreate, onUpdate, onDelete, onClose }: Props) {
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
            <h2 id="label-manager-title">Метки проекта</h2>
            <p id="label-manager-description" className="muted">Для организации и фильтрации задач</p>
          </div>
          <button className="icon-btn" title="Закрыть (Esc)" aria-label="Закрыть окно меток" onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="label-rows">
          {labels.length === 0 && <p className="label-empty-state muted">Меток пока нет. Создайте первую ниже.</p>}
          {labels.map((label) => {
            const used = usage.get(label.id) ?? 0;
            return (
              <div key={label.id} className="label-entry">
                <div className="label-row">
                  <LabelColorPicker color={label.color} name={"Цвет метки " + label.name} onChange={(color) => onUpdate(label.id, { color })} />
                  <LabelNameInput name={label.name}
                    taken={(n) => labels.some((l) => l.id !== label.id && l.name.toLowerCase() === n.toLowerCase())}
                    onRename={(name) => onUpdate(label.id, { name })} />
                  <span className="muted label-usage" title="Включая задачи в архиве">{taskCount(used)}</span>
                  <button className="icon-btn label-delete danger-hover" title={"Удалить метку «" + label.name + "»"}
                    aria-label={"Удалить метку «" + label.name + "»"}
                    onClick={() => used ? setConfirmDelete(label.id) : onDelete(label.id)}><Icon name="trash" /></button>
                </div>
                {confirmDelete === label.id && (
                  <div className="label-delete-confirm">
                    <p className="muted">Метка снимется со всех задач ({used}). Сами задачи останутся.</p>
                    <div className="label-confirm">
                      <button className="btn danger small-btn" onClick={() => { onDelete(label.id); setConfirmDelete(null); }}>Удалить метку</button>
                      <button className="btn small-btn" onClick={() => setConfirmDelete(null)}>Отмена</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="label-create-section">
          <div className="label-create">
            <LabelColorPicker color={newColor || nextLabelColor(labels)} name="Цвет новой метки" onChange={setNewColor} />
            <input ref={newInput} className="inline-input" aria-label="Название новой метки" value={newName}
              maxLength={LABEL_NAME_MAX} placeholder="Новая метка…" aria-invalid={duplicate || undefined}
              onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); create(); }
              }} />
            <button className="btn primary label-create-button" title="Добавить метку" aria-label="Добавить метку"
              disabled={!newName.trim() || duplicate} onClick={create}><Icon name="plus" /></button>
          </div>
          {duplicate && newName.trim() && <p className="label-duplicate" role="status">Такая метка уже есть.</p>}
          <p className="label-autosave muted">Изменения сохраняются автоматически</p>
        </div>
      </div>
    </div>
  );
}

function LabelColorPicker({ color, name, onChange }: { color: string; name: string; onChange: (color: string) => void }) {
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
        <div className="color-palette" role="group" aria-label="Выбор цвета">
          {LABEL_COLORS.map((c) => (
            <button type="button" key={c.key}
              className={`color-swatch ${c.key === color ? "current" : ""}`}
              style={labelStyle(c.key)} title={c.name} aria-label={c.name}
              aria-pressed={c.key === color}
              onClick={() => { onChange(c.key); setOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Название метки: правится на месте, сохраняется при уходе из поля или по Enter. */
function LabelNameInput({
  name,
  taken,
  onRename,
}: {
  name: string;
  taken: (name: string) => boolean;
  onRename: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);

  function commit() {
    const trimmed = value.trim();
    // Пустое или занятое имя не сохраняем — возвращаем прежнее.
    if (!trimmed || taken(trimmed)) setValue(name);
    else if (trimmed !== name) onRename(trimmed);
  }

  return (
    <input
      className="label-name-input"
      aria-label={"Название метки " + name}
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
