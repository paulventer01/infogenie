import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "InfoGenie",
  description: "AI Marketing Intelligence — for your team",
  robots: { index: false, follow: false },
};

// Apply the saved light/dark preference before first paint to prevent a flash.
// Mirrors the inline theme-init script in the legacy index.html.
const themeInit = `(function(){try{var t=localStorage.getItem('ig-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}}());`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        {/* Theme init — must run before paint. */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {/* Analytics stubs — wired up in a later phase (Amplitude / PostHog). */}
      </head>
      <body>{children}</body>
    </html>
  );
}
