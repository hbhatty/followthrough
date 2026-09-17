import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Followthrough — your saved collection",
    template: "%s · Followthrough",
  },
  description: "A quiet place to return to saved ideas and keep what matters.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <main id="main-content" tabIndex={-1}>{children}</main>
      </body>
    </html>
  );
}
