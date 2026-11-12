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
  /** Character limit. Show a counter below the input when approaching the limit. */
  maxLength?: number;
  /** Multiline input that grows with its content (Enter still submits). */
  multiline?: boolean;
  /** Submit on Enter or blur. Empty or unchanged values cancel the edit. */
  onCommit: (value: string, via: "enter" | "blur") => void;
  /** Escape. */
  onCancel: () => void;
}

/** Show the counter when the input exceeds this fraction of the limit. */
const COUNTER_THRESHOLD = 0.8;

/** Input for quick creation and renaming: focused immediately with its text selected. */
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
  // Enter followed by blur must not submit twice.
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  // Resize the multiline input to fit its text.
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
      // During IME composition, Enter confirms a character rather than submitting the input.
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
