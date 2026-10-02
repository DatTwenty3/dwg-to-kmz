import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Montserrat, Roboto } from "next/font/google";
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

// Map label font for deck.gl's text atlas (resolved at runtime in App.tsx via --font-roboto).
const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "LEDAT-GIS",
  description: "LEDAT-GIS — đưa bản vẽ DWG, DXF, KMZ, KML lên bản đồ Google Hybrid, xuất KMZ/KML/DXF",
  authors: [{ name: "LEDAT" }],
  creator: "LEDAT",
  applicationName: "LEDAT-GIS",
  // Home-screen web app on iOS (Add to Home Screen); icons come from app/apple-icon.png and app/manifest.ts.
  appleWebApp: { capable: true, title: "LEDAT-GIS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${ui.variable} ${brand.variable} ${roboto.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
