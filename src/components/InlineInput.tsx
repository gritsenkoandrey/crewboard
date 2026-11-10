import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

interface Props {
  initial?: string;
  placeholder?: string;
  className?: string;
  /** Максимум символов. Ближе к пределу под полем появляется счётчик. */
  maxLength?: number;
  /** Многострочное поле, которое растёт по высоте вместе с текстом (Enter всё равно сохраняет). */
  multiline?: boolean;
  /** Enter или потеря фокуса. Пустое или неизменённое значение считается отменой. */
  onCommit: (value: string, via: "enter" | "blur") => void;
  /** Escape. */
  onCancel: () => void;
}

/** Показываем счётчик, когда набрано больше этой доли от лимита. */
const COUNTER_THRESHOLD = 0.8;

/** Поле ввода для быстрого создания и переименования: сразу в фокусе, текст выделен. */
export default function InlineInput({
  initial = "",
  placeholder,
  className,
  maxLength = 200,
  multiline = false,
  onCommit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // Enter и последующий blur не должны сработать дважды.
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  // Высота многострочного поля подстраивается под текст.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!multiline || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, multiline]);

  function finish(via: "enter" | "blur" | null) {
    if (done.current) return;
    done.current = true;
    const trimmed = value.trim();
    if (via && trimmed && trimmed !== initial.trim()) onCommit(trimmed, via);
    else onCancel();
  }

  const props = {
    ref,
    className: `inline-input ${multiline ? "multiline" : ""} ${className ?? ""}`,
    value,
    placeholder,
    maxLength,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.target.value),
    onKeyDown: (e: KeyboardEvent) => {
      // Во время набора через IME Enter подтверждает символ, а не поле.
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        finish("enter");
      } else if (e.key === "Escape") {
        finish(null);
      }
    },
    onBlur: () => finish("blur"),
    onClick: (e: MouseEvent) => e.stopPropagation(),
  };

  const showCounter = value.length > maxLength * COUNTER_THRESHOLD;

  return (
    <div className="inline-input-wrap">
      {multiline ? <textarea rows={1} {...props} /> : <input {...props} />}
      {showCounter && (
        <div className={`input-counter ${value.length >= maxLength ? "full" : ""}`}>
          {value.length} / {maxLength}
        </div>
      )}
    </div>
  );
}
