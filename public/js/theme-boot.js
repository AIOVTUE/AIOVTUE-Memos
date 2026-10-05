try {
  document.documentElement.dataset.theme =
    localStorage.getItem("hugo_memos_theme") === "dark" ? "dark" : "light";
} catch (e) {}
