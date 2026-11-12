import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MouseEvent } from "react";

const md = new MarkdownIt({ html: true, linkify: true, breaks: false });

/** The link targets an external site or email address rather than a file next to the document. */
export function isExternalUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[a-z]:[\\/]/i.test(url);
}

/**
 * Click handler for rendered Markdown. Do not open links inside the application
 * window: send external links (http, https, mailto) to the system browser and ignore the rest.
 */
export function handleMarkdownClick(e: MouseEvent, onError: (message: string) => void) {
  const link = (e.target as HTMLElement).closest("a");
  if (!link) return;
  e.preventDefault();
  const href = link.getAttribute("href") ?? "";
  if (/^(https?|mailto):/i.test(href)) {
    openUrl(href).catch((err) => onError(`Failed to open the link: ${err}`));
  }
}

/** Joins a folder and a relative path, resolving `.` and `..`. */
function resolvePath(baseDir: string, relative: string): string {
  if (/^[a-z]:[\\/]/i.test(relative) || relative.startsWith("\\\\")) return relative;
  const parts = baseDir.split(/[\\/]+/).filter(Boolean);
  for (const part of relative.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") parts.length > 1 && parts.pop();
    else parts.push(part);
  }
  return parts.join("\\");
}

/**
 * Renders Markdown as safe HTML. Resolve relative image paths
 * (for example, `![](screens/menu.png)`) against the project folder.
 */
export function renderMarkdown(source: string, baseDir: string): string {
  const env = {};
  const tokens = md.parse(source, env);
  for (const token of tokens) {
    if (token.type !== "inline" || !token.children) continue;
    for (const child of token.children) {
      if (child.type !== "image") continue;
      const src = child.attrGet("src");
      if (typeof src === "string" && src && !isExternalUrl(src)) {
        let path = src;
        try {
          path = decodeURI(src);
        } catch {
          // Invalid percent escape: leave the path unchanged.
        }
        child.attrSet("src", convertFileSrc(resolvePath(baseDir, path)));
      }
    }
  }
  return DOMPurify.sanitize(md.renderer.render(tokens, md.options, env));
}
