"use client";

import { useTheme } from "next-themes";
import { ReactNode, useLayoutEffect } from "react";

// The branding's theme mode as next-themes names it (dynamic-theme.tsx reads
// it from the branding on the server): a forced light or dark, else the system's.
export type ColorScheme = "light" | "dark" | "system";

type Props = {
  // undefined without a branding: the theme is left as it is
  colorScheme?: ColorScheme;
  children: ReactNode;
};

export const ThemeWrapper = ({ children, colorScheme }: Props) => {
  const { setTheme: setNextTheme } = useTheme();

  // Handle branding themeMode to force specific theme.
  // Uses useLayoutEffect to apply before paint and writes the forced value
  // to localStorage so next-themes doesn't fall back to system default.
  useLayoutEffect(() => {
    switch (colorScheme) {
      case "light":
        document.documentElement.classList.remove("dark");
        try {
          localStorage.setItem("cp-theme", "light");
        } catch {
          /* localStorage unavailable (e.g. private mode) */
        }
        setNextTheme("light");
        break;
      case "dark":
        document.documentElement.classList.add("dark");
        try {
          localStorage.setItem("cp-theme", "dark");
        } catch {
          /* localStorage unavailable (e.g. private mode) */
        }
        setNextTheme("dark");
        break;
      case "system":
        setNextTheme("system");
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorScheme]);

  return <div>{children}</div>;
};
