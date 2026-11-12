import { useI18n } from "../i18n";
import { labelStyle } from "../labels";
import type { Label } from "../types";

/** Filter key for unlabeled tasks. Cannot collide with label IDs, which contain only letters and digits. */
export const NO_LABEL = "__none__";

interface Props {
  labels: Label[];
  /** Task counts per label, with unlabeled tasks under NO_LABEL. */
  counts: Map<string, number>;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
  onManage: () => void;
}

/** Board filter bar: labels with task counts, unlabeled tasks, and label management. */
export default function LabelFilter({ labels, counts, selected, onToggle, onClear, onManage }: Props) {
  const { t } = useI18n();
  return (
    <div className="label-filter">
      <span className="label-filter-heading">
        <span className="muted label-filter-title">{t("Labels:")}</span>
        <button type="button" className="icon-btn manage-labels" onClick={onManage}
          title={t("Manage labels")} aria-label={t("Manage labels")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.5 3h5l.6 2.5 2 .9 2.3-.8 2.5 4.3-1.8 1.7v2.3l1.8 1.7-2.5 4.3-2.3-.8-2 .9-.6 2.5h-5l-.6-2.5-2-.9-2.3.8-2.5-4.3 1.8-1.7v-2.3L1.7 9.9l2.5-4.3 2.3.8 2-.9L9.5 3Z" />
            <circle cx="12" cy="12.75" r="3" />
          </svg>
        </button>
      </span>
      {labels.length === 0 && <span className="muted">{t("No labels yet — create them here or in a task")}</span>}
      {labels.map((label) => (
        <button
          key={label.id}
          className={`filter-chip ${selected.has(label.id) ? "active" : ""}`}
          style={labelStyle(label.color)}
          onClick={() => onToggle(label.id)}
        >
          <span className="label-dot" />
          {label.name}
          <span className="filter-count">{counts.get(label.id) ?? 0}</span>
        </button>
      ))}
      {labels.length > 0 && (
        <button
          className={`filter-chip no-label ${selected.has(NO_LABEL) ? "active" : ""}`}
          onClick={() => onToggle(NO_LABEL)}
        >
          {t("Unlabeled")}<span className="filter-count">{counts.get(NO_LABEL) ?? 0}</span>
        </button>
      )}
      {selected.size > 0 && (
        <button className="link-btn" onClick={onClear}>
          {t("Reset")}</button>
      )}
    </div>
  );
}
