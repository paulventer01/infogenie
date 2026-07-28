import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Sora, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "InfoGenie",
  description: "AI Marketing Intelligence — for your team",
  robots: { index: false, follow: false },
};

// Fonts via next/font only (no hand-authored <link> in <head> — see
// test/layout-fonts-guard.test.js). Sora = display/brand, Space Grotesk = logo,
// Plus Jakarta Sans = UI body. Inter retired as the default stack.
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

// Default to light theme; honor an explicit dark preference if stored.
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
      className={`${sora.variable} ${spaceGrotesk.variable} ${jakarta.variable}`}
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
        {children}
      </body>
    </html>
  );
}
