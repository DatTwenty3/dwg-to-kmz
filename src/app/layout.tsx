import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Montserrat } from "next/font/google";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// UI font: designed for Vietnamese diacritics.
const ui = Be_Vietnam_Pro({
  variable: "--font-ui",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

// Brand wordmark ("LEDAT-GIS" / "GEOSPATIAL SOLUTIONS"), matching the logo artwork.
const brand = Montserrat({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["500", "700"],
});

// Map label font for deck.gl's text atlas (resolved at runtime in App.tsx via --font-roboto). Self-hosted: Roboto
// (OFL) subset to Latin + Vietnamese, one variable-weight file (assets/fonts/OFL-Roboto.txt). The Google copy made the
// production build fail on Vercel ("next/font/google queries have exactly one entry") when Google served Roboto's CSS
// with the new width axis, and a build must not depend on what Google answers that day.
const roboto = localFont({
  src: "../../assets/fonts/Roboto-vi-wght.woff2",
  variable: "--font-roboto",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LEDAT-GIS",
  description: "LEDAT-GIS — đưa bản vẽ DWG, DXF, KMZ, KML lên bản đồ Google Hybrid, xuất KMZ/KML/DXF",
  authors: [{ name: "LEDAT" }],
  creator: "LEDAT",
  applicationName: "LEDAT-GIS",
  // Home-screen web app on iOS (Add to Home Screen); icons come from app/apple-icon.png and app/manifest.ts.
  appleWebApp: { capable: true, title: "LEDAT-GIS", statusBarStyle: "default" },
  // Link previews (Zalo, Messenger, Facebook…). Shared map links override title/image in app/page.tsx.
  openGraph: {
    type: "website",
    siteName: "LEDAT-GIS",
    locale: "vi_VN",
    title: "LEDAT-GIS — Geospatial Solutions",
    description: "Đưa bản vẽ DWG, DXF, KMZ, KML lên bản đồ Google Hybrid, vẽ, đo đạc và chia sẻ bản đồ.",
    images: [{ url: "/og", width: 1200, height: 630, alt: "LEDAT-GIS" }],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${ui.variable} ${brand.variable} ${roboto.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
