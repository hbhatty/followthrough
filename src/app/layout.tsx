import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "followthrough",
  description: "Save links, rate their usefulness, and keep your notes.",
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
