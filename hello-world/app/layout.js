import "./globals.css";
import { Manrope, Source_Serif_4 } from "next/font/google";
import Providers from "@/app/components/Providers";
import AppHeader from "@/app/components/AppHeader";
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
          <AppHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
