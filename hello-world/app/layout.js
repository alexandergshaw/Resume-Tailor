import "./globals.css";
import { Manrope, Source_Serif_4 } from "next/font/google";
import Providers from "@/app/components/Providers";
import AuthButton from "@/app/components/AuthButton";
import GmailButton from "@/app/components/GmailButton";
import ThemeToggle from "@/app/components/ThemeToggle";
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
          <header style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "10px clamp(12px, 4vw, 24px)",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-surface)",
            gap: "12px",
            flexWrap: "wrap",
          }}>
            <ThemeToggle />
            <GmailButton />
            <AuthButton />
          </header>
          {children}
        </Providers>
      </body>
    </html>
  );
}
