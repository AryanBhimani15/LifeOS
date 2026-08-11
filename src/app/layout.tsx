import type { Metadata } from "next";
import Script from "next/script";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "LifeOS",
  description: "Your personal command center.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Applies the stored theme before first paint, so the page never renders
          light and then flips on hydration.

          Rendered with next/script at `beforeInteractive` rather than a bare
          <script> tag: React 19 warns that scripts inside a component are never
          executed on the client, and next/script is the supported way to run
          something ahead of hydration without that warning.
        */}
        <Script id="lifeos-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
