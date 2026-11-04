import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ApiModeProvider } from "@/context/api-mode";
import { ThemeProvider } from "@/context/theme-context";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "600"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "EvalVerse",
  description:
    "EvalVerse evaluates multimodal agents (images, audio, video) with evidence, traces and measured judges.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${inter.variable} ${jetbrains.variable} font-sans antialiased`}>
        <ThemeProvider>
          <ApiModeProvider>{children}</ApiModeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
