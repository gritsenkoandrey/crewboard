import { useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { Release } from "../types";
import Icon from "./Icon";

const RELEASE_NAME_MAX = 80;

interface Props {
  releases: Release[];
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (release: Release) => void;
}

export default function ReleaseFilter({ releases, selected, disabled, onSelect, onCreate, onRename, onDelete }: Props) {
  const { t } = useI18n();
  const selectId = useId();
  const duplicateId = useId();
  const select = useRef<HTMLSelectElement>(null);
  const [draft, setDraft] = useState<{ id: string | null; name: string } | null>(null);
  const active = releases.find((release) => release.id === selected);
  const name = draft?.name.trim() ?? "";
  const duplicate = releases.some((release) => release.id !== draft?.id && release.name.toLowerCase() === name.toLowerCase());
  const canSubmit = !disabled && !!name && !duplicate && (!draft?.id || (draft.id === active?.id && name !== active.name));

  function closeForm() {
    setDraft(null);
    select.current?.focus();
  }

  return (
    <div className="filter-row">
      <label htmlFor={selectId} className="filter-row-heading muted">{t("Releases")}</label>
      <div className="release-filter">
        <div className="release-filter-controls">
          <select ref={select} id={selectId} className="inline-input" value={selected ?? ""} disabled={disabled}
            onChange={(event) => {
              setDraft(null);
              onSelect(event.target.value || null);
            }}>
            <option value="">{t("Original board")}</option>
            {releases.map((release) => <option key={release.id} value={release.id}>{release.name}</option>)}
          </select>
          {draft === null && <>
            <button type="button" className="btn small-btn" disabled={disabled} onClick={() => setDraft({ id: null, name: "" })}>
              <Icon name="plus" />{t("New release")}
            </button>
            {active && <>
              <button type="button" className="btn small-btn" disabled={disabled}
                onClick={() => setDraft({ id: active.id, name: active.name })}>
                <Icon name="edit" />{t("Rename release")}
              </button>
              <button type="button" className="btn small-btn" disabled={disabled} onClick={() => onDelete(active)}>
                <Icon name="trash" />{t("Delete release")}
              </button>
            </>}
          </>}
        </div>
        {draft !== null && <form className="release-filter-controls" onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          if (draft.id) onRename(draft.id, name);
          else onCreate(name);
          closeForm();
        }} onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            closeForm();
          }
        }}>
          <input className="inline-input" aria-label={t("Release name")} placeholder={t("Release name")}
            aria-invalid={duplicate || undefined} aria-describedby={duplicate ? duplicateId : undefined}
            value={draft.name} maxLength={RELEASE_NAME_MAX} disabled={disabled} autoFocus
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <button type="submit" className="btn small-btn primary" disabled={!canSubmit}>{t(draft.id ? "Save" : "Create")}</button>
          <button type="button" className="btn small-btn" onClick={closeForm}>{t("Cancel")}</button>
          {duplicate && <div id={duplicateId} className="release-filter-error error" role="status">{t("A release with this name already exists.")}</div>}
        </form>}
      </div>
    </div>
  );
}
