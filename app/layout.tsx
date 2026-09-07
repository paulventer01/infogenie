import type { Metadata } from "next";
import { Outfit, Manrope } from "next/font/google";
import Script from "next/script";
import "../styles/globals.css";
import "../styles/theme-v2.css";
import "../styles/ig-unified.css";
import HideNextDevBadge from "@/components/layout/HideNextDevBadge";

export const metadata: Metadata = {
  title: "InfoGenie",
  description: "AI Marketing Intelligence — for your team",
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

// Outfit = display/brand (MVP), Manrope = UI body. Loaded via next/font only
// (no hand-authored <link> in <head> — see test/layout-fonts-guard.test.js).
const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const themeInit = `(function(){try{var t=localStorage.getItem('ig-theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');}else{document.documentElement.setAttribute('data-theme','light');if(!t)localStorage.setItem('ig-theme','light');}}catch(e){document.documentElement.setAttribute('data-theme','light');}}());`;

const clarityInit = `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i+"?ref=bwt";y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","xg1cxshout");`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${manrope.variable}`}
      data-theme="light"
      suppressHydrationWarning
    >
      <body>
        <Script
          id="ig-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInit }}
        />
        <Script
          id="ms-clarity"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: clarityInit }}
        />
        <HideNextDevBadge />
        {children}
      </body>
    </html>
  );
}
