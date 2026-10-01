import type { Metadata } from "next";
import { Be_Vietnam_Pro, Roboto } from "next/font/google";
import "./globals.css";

// UI font: designed for Vietnamese diacritics.
const ui = Be_Vietnam_Pro({
  variable: "--font-ui",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

// Map label font for deck.gl's text atlas (resolved at runtime in App.tsx via --font-roboto).
const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "DWG → KMZ",
  description: "Hiển thị bản vẽ DWG/DXF trên nền Google Hybrid và xuất KML/KMZ",
  authors: [{ name: "LEDAT" }],
  creator: "LEDAT",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${ui.variable} ${roboto.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
