export interface ViewPreferences {
  filtersOpen: boolean;
  scrollTop: number;
  scrollLeft: number;
  descriptionSize: number | null;
  releaseId: string | null;
}

function normalize(value: unknown): ViewPreferences {
  const saved = value && typeof value === "object" ? value as Partial<ViewPreferences> : {};
  const position = (number: unknown) => typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : 0;
  return {
    filtersOpen: saved.filtersOpen === true,
    scrollTop: position(saved.scrollTop),
    scrollLeft: position(saved.scrollLeft),
    descriptionSize: typeof saved.descriptionSize === "number" && Number.isFinite(saved.descriptionSize)
      && saved.descriptionSize >= 0 && saved.descriptionSize <= 100 ? saved.descriptionSize : null,
    releaseId: typeof saved.releaseId === "string" && saved.releaseId.trim() ? saved.releaseId : null,
  };
}

// The data-folder path distinguishes projects with the same ID in different stores.
function storageKey(projectDir: string): string {
  return `board-view:v1:${projectDir}`;
}

export function loadViewPreferences(projectDir: string): ViewPreferences {
  try {
    return normalize(JSON.parse(localStorage.getItem(storageKey(projectDir)) ?? "null"));
  } catch {
    return normalize(null);
  }
}

/** Merge only the changed fields so scrolling cannot overwrite a new panel size. */
export function saveViewPreferences(projectDir: string, patch: Partial<ViewPreferences>): void {
  try {
    const next = normalize({ ...loadViewPreferences(projectDir), ...patch });
    localStorage.setItem(storageKey(projectDir), JSON.stringify(next));
  } catch {
    // Storage can be disabled or full; preferences must never block editing tasks.
  }
}
