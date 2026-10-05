const THEME_KEY = "hugo_memos_theme";

export function getTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === "dark" ? "#161414" : "#df9193";
}

export function toggleTheme() {
  applyTheme(getTheme() === "dark" ? "light" : "dark");
  return getTheme();
}

export function initTheme() {
  let stored = "";
  try {
    stored = localStorage.getItem(THEME_KEY) || "";
  } catch {
    stored = "";
  }
  applyTheme(stored === "dark" ? "dark" : "light");
}
