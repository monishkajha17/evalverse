export type StudioTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "evalverse.theme";

export function readStoredTheme(): StudioTheme | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    /* ignore */
  }
  return null;
}

/** Light is the default; prefers-color-scheme is ignored for now. */
export function resolveInitialTheme(): StudioTheme {
  return readStoredTheme() || "light";
}

export function applyTheme(theme: StudioTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(theme);
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Inline script for root layout — light default, no flash. */
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k);if(t!=="light"&&t!=="dark"){t="light";}var r=document.documentElement;r.classList.remove("dark","light");r.classList.add(t);r.style.colorScheme=t;}catch(e){var r2=document.documentElement;r2.classList.add("light");r2.style.colorScheme="light";}})();`;
