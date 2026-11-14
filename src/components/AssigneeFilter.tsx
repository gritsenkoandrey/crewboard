import { useI18n } from "../i18n";
import type { Participant } from "../types";
import Icon from "./Icon";

/** Cannot collide with participant IDs, which contain only letters, digits and hyphens. */
export const NO_ASSIGNEE = "__unassigned__";

interface Props {
  participants: Pick<Participant, "id" | "name">[];
  counts: Map<string, number>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}

export default function AssigneeFilter({ participants, counts, selected, onToggle, onClear }: Props) {
  const { t } = useI18n();
  return <div className="assignee-filter filter-row" role="group" aria-label={t("Filter by assignee")}>
    <span className="assignee-filter-heading filter-row-heading muted">
      {t("Participants:")}
    </span>
    <div className="filter-options">
    <button type="button" className={"filter-chip filter-all" + (!selected.size ? " active" : "")}
      aria-pressed={!selected.size} onClick={onClear}>{t("All")}<Icon name="check" className="filter-choice-check" /></button>
    {[...participants, { id: NO_ASSIGNEE, name: t("Without assignee") }].map((participant) => <button
      key={participant.id} type="button" title={participant.name} aria-pressed={selected.has(participant.id)}
      className={"filter-chip assignee-chip" + (selected.has(participant.id) ? " active" : "") + (participant.id === NO_ASSIGNEE ? " no-label" : "")}
      onClick={() => onToggle(participant.id)}>
      <span className="filter-avatar" aria-hidden="true">{participant.id === NO_ASSIGNEE ? "—" : initials(participant.name)}</span>
      <span className="filter-choice-name">{participant.name}</span>
      <span className="filter-count" aria-hidden="true">{counts.get(participant.id) ?? 0}</span>
      <Icon name="check" className="filter-choice-check" />
    </button>)}
    </div>
  </div>;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0] ?? "").join("").toLocaleUpperCase();
}
