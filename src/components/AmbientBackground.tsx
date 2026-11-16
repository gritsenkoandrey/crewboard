import { useEffect, useRef } from "react";
import "./AmbientBackground.css";

/** Decorative light shared by the welcome screen and project library. */
export default function AmbientBackground({ variant = "welcome" }: { variant?: "welcome" | "projects" }) {
  const background = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = background.current!;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let focused = document.hasFocus();
    const sync = () => { element.dataset.animating = String(focused && !document.hidden && !motion.matches); };
    const focus = () => { focused = true; sync(); };
    const blur = () => { focused = false; sync(); };
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    sync();
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
    };
  }, []);
  return <div ref={background} className={`ambient-background ambient-background--${variant}`} aria-hidden="true" />;
}
