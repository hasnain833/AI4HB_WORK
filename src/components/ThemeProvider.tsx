"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { ReactNode } from "react";

// The theme script must run from the server HTML (no flash). On the client React 19 warns about
// rendering a <script>, so mark it inert there; it has already run by then.
const scriptProps = typeof window === "undefined" ? undefined : ({ type: "application/json" } as const);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem scriptProps={scriptProps}>
      {children}
    </NextThemesProvider>
  );
}
