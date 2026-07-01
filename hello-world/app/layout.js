import "./globals.css";
import { Manrope, Source_Serif_4 } from "next/font/google";
import Providers from "@/app/components/Providers";
import EngineSelect from "@/app/components/EngineSelect";
import SettingsMenu from "@/app/components/SettingsMenu";
import { themeCssText, noFlashScript } from "@/app/theme";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata = {
  title: "Resume Tailor",
  description: "Generate tailored resume drafts from a job posting and your resume.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Design-token CSS variables (light + dark), rendered SSR so first
            paint is correct. Single source of truth: app/theme/tokens.js. */}
        <style id="theme-tokens" dangerouslySetInnerHTML={{ __html: themeCssText() }} />
        {/* Apply persisted / system color mode before paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className={`${manrope.variable} ${sourceSerif.variable}`}>
        <Providers>
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
          {children}
        </Providers>
      </body>
    </html>
  );
}
