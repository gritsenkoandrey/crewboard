import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { convertFileSrc } from "@tauri-apps/api/core";

const md = new MarkdownIt({ html: true, linkify: true, breaks: false });

/** Ссылка ведёт наружу (сайт, почта), а не на файл рядом с документом. */
export function isExternalUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[a-z]:[\\/]/i.test(url);
}

/** Склеивает папку и относительный путь, раскрывая `.` и `..`. */
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
 * Отрисовывает markdown в безопасный HTML. Картинки с относительными путями
 * (например `![](screens/menu.png)`) берутся из папки проекта.
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
          // Невалидная %-последовательность: оставляем путь как есть.
        }
        child.attrSet("src", convertFileSrc(resolvePath(baseDir, path)));
      }
    }
  }
  return DOMPurify.sanitize(md.renderer.render(tokens, md.options, env));
}
