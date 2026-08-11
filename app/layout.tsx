import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./beautiful-ui.css";

export const metadata: Metadata = {
  title: "Kris's Script",
  description: "AI chat platform powered by DeepSeek and SubScript USDC payments on Arc",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b0f17",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
