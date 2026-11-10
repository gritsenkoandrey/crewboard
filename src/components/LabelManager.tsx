import { useEffect, useState } from "react";
import { LABEL_COLORS, LABEL_NAME_MAX, labelStyle } from "../labels";
import type { Label } from "../types";

interface Props {
  labels: Label[];
  /** В скольких задачах используется каждая метка. */
  usage: Map<string, number>;
  onCreate: (name: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<Label, "name" | "color">>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** Окно «Метки проекта»: создать, переименовать, сменить цвет, удалить. */
export default function LabelManager({ labels, usage, onCreate, onUpdate, onDelete, onClose }: Props) {
  const [newName, setNewName] = useState("");
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Сначала закрываем вложенное (палитру, подтверждение), потом само окно.
      if (colorFor) setColorFor(null);
      else if (confirmDelete) setConfirmDelete(null);
      else onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [colorFor, confirmDelete, onClose]);

  function create() {
    const name = newName.trim();
    if (!name) return;
    if (labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) return;
    onCreate(name);
    setNewName("");
  }

  const duplicate = labels.some((l) => l.name.toLowerCase() === newName.trim().toLowerCase());

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog label-manager" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Метки проекта</h2>

        <div className="label-rows">
          {labels.length === 0 && <p className="muted">Меток пока нет.</p>}
          {labels.map((label) => {
            const used = usage.get(label.id) ?? 0;
            return (
              <div key={label.id} className="label-row">
                <div className="color-cell">
                  <button
                    className="color-swatch"
                    style={labelStyle(label.color)}
                    title="Сменить цвет"
                    onClick={() => setColorFor(colorFor === label.id ? null : label.id)}
                  />
                  {colorFor === label.id && (
                    <div className="color-palette">
                      {LABEL_COLORS.map((c) => (
                        <button
                          key={c.key}
                          className={`color-swatch ${c.key === label.color ? "current" : ""}`}
                          style={labelStyle(c.key)}
                          title={c.name}
                          onClick={() => {
                            onUpdate(label.id, { color: c.key });
                            setColorFor(null);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <LabelNameInput
                  name={label.name}
                  taken={(n) => labels.some((l) => l.id !== label.id && l.name.toLowerCase() === n.toLowerCase())}
                  onRename={(name) => onUpdate(label.id, { name })}
                />

                <span className="muted label-usage" title="Задач с этой меткой">
                  {used}
                </span>

                {confirmDelete === label.id ? (
                  <span className="label-confirm">
                    <button className="btn danger small-btn" onClick={() => (onDelete(label.id), setConfirmDelete(null))}>
                      Удалить
                    </button>
                    <button className="btn small-btn" onClick={() => setConfirmDelete(null)}>
                      Нет
                    </button>
                  </span>
                ) : (
                  <button
                    className="icon-btn danger-hover"
                    title={used ? `Удалить — снимется с ${used} задач` : "Удалить"}
                    onClick={() => (used ? setConfirmDelete(label.id) : onDelete(label.id))}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {confirmDelete && (
            <p className="muted small">
              Метка снимется со всех задач ({usage.get(confirmDelete) ?? 0}). Сами задачи останутся.
            </p>
          )}
        </div>

        <div className="label-create">
          <input
            className="inline-input"
            value={newName}
            maxLength={LABEL_NAME_MAX}
            placeholder="Новая метка…"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) create();
            }}
          />
          <button className="btn" disabled={!newName.trim() || duplicate} onClick={create}>
            Добавить
          </button>
        </div>
        {duplicate && newName.trim() && <p className="muted small">Такая метка уже есть.</p>}

        <div className="dialog-actions">
          <button className="btn primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
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
