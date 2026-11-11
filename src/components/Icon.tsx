import type { SVGProps } from "react";
type Name = "close" | "trash" | "more" | "plus" | "back" | "archive" | "restore" | "link";
const paths: Record<Name, string> = {
  close: "M6 6l12 12M6 18 18 6",
  trash: "M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  archive: "M3 3h18v5H3zM5 8v13h14V8M10 12h4",
  restore: "M3 10h5V5M3 10a9 9 0 1 1 1 9",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
  back: "M19 12H5M12 5l-7 7 7 7",
};
export default function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: Name }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
