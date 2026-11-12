import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";

interface Props {
  initialText: string;
  onChange: (text: string) => void;
  /** Ctrl+S saves immediately without waiting for autosave. */
  onSave: () => void;
}

// CSS variables keep editor colors in sync with the application's light or dark theme.
const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "15px", color: "var(--text)", backgroundColor: "var(--bg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.65" },
  ".cm-content": { padding: "16px 20px 80px", caretColor: "var(--accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-activeLine": { backgroundColor: "var(--hover-soft)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--selection)" },
});

const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.35em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.2em", fontWeight: "700" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", fontSize: "0.9em" },
  { tag: t.quote, color: "var(--muted)" },
  // Markdown syntax characters: #, *, `, >, -.
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: "var(--muted)" },
]);

/** CodeMirror Markdown editor. Created once; a new document requires a new component key. */
export default function MarkdownEditor({ initialText, onChange, onSave }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(highlightStyle),
          theme,
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.focus();
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="md-editor" ref={hostRef} />;
}
