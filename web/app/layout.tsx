import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { site } from "@/lib/site";
import { fmtInt } from "@/lib/format";
import "./globals.css";

const title = "Misheard: a map of where speech models get it wrong";

const description = `${fmtInt(site.nClips)} clips of real conversational audio, placed on a map and colored by how badly speech models misheard them.`;

export const metadata: Metadata = {
  title: site.isSample ? `[Sample data] ${title}` : title,
  description,
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary", title, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#0a0a0b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        {/* sections fade in with JavaScript; without it they must simply be there */}
        <noscript>
          <style>{"[data-reveal]{opacity:1!important;transform:none!important}"}</style>
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
