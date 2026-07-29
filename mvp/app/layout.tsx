import type { Metadata } from "next";
import { Outfit, Manrope } from "next/font/google";
import "@/styles/globals.css";

const display = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800"],
});

const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "InfoGenie MVP",
  description: "Agency command center — analyse, create, launch, reach, prove.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}
