import { useLayoutEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "tracon.theme";
const BAR = { dark: "#020617", light: "#f8fafc" }; // slate-950 / slate-50, the page background

/** Saved choice, else the system's; index.css mirrors the palette under data-theme="light". */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem(KEY);
      if (t === "dark" || t === "light") return t;
    } catch {
      /* private window: fall back to the system setting */
    }
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  // before paint, so a light page never flashes dark after the first render
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[theme]);
  }, [theme]);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private window: the choice lasts for this tab only */
    }
  };
  return { theme, toggle };
}
