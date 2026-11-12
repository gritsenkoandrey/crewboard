import { useI18n } from "../i18n";
import { useEffect, type ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, children, confirmLabel, danger, onConfirm, onCancel }: Props) {
  const { t } = useI18n();
  // The focused confirmation button handles Enter (autoFocus).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel}>
            {t("Cancel")}</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
