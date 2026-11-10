import { useEffect, useRef, useState } from "react";

interface Props {
  initial?: string;
  placeholder?: string;
  className?: string;
  /** Enter или потеря фокуса. Пустое значение считается отменой. */
  onCommit: (value: string) => void;
  /** Escape. */
  onCancel: () => void;
}

/** Поле ввода для быстрого создания и переименования: сразу в фокусе, текст выделен. */
export default function InlineInput({ initial = "", placeholder, className, onCommit, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  // Enter и последующий blur не должны сработать дважды.
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function finish(commit: boolean) {
    if (done.current) return;
    done.current = true;
    const trimmed = value.trim();
    if (commit && trimmed && trimmed !== initial.trim()) onCommit(trimmed);
    else onCancel();
  }

  return (
    <input
      ref={ref}
      className={`inline-input ${className ?? ""}`}
      value={value}
      placeholder={placeholder}
      maxLength={200}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
