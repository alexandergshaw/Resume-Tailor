"use client";

import { usePathname } from "next/navigation";
import EngineSelect from "./EngineSelect";
import SettingsMenu from "./SettingsMenu";

// Sticky top bar for the app. Hidden on standalone auth routes (/login,
// /auth/*) so those pages render as clean full-screen surfaces without the
// app chrome (engine picker, settings).
export default function AppHeader() {
  const pathname = usePathname() || "";
  if (pathname.startsWith("/login") || pathname.startsWith("/auth")) return null;

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px clamp(12px, 4vw, 24px)",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          marginRight: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          fontFamily: "var(--font-source-serif), Georgia, serif",
          fontWeight: 600,
          fontSize: "1.15rem",
          letterSpacing: "-0.01em",
          color: "var(--text-primary)",
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: "var(--accent)",
            flexShrink: 0,
          }}
        />
        Resume Tailor
      </span>
      <EngineSelect />
      <SettingsMenu />
    </header>
  );
}
