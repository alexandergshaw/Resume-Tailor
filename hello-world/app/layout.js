import "./globals.css";
import { Manrope, Source_Serif_4 } from "next/font/google";
import Providers from "@/app/components/Providers";
import AppHeader from "@/app/components/AppHeader";
import SkipLink from "@/app/components/SkipLink";
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
        {/* FIRST child of <body>, and deliberately outside <Providers>: this
            is the document's first tab stop (WCAG 2.4.1), and it needs no MUI
            theme. It must NOT move inside <AppHeader> — the back control's own
            tests pin that control as the header's first child and first
            focusable. See app/components/SkipLink.js. */}
        <SkipLink />
        <Providers>
          <AppHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
