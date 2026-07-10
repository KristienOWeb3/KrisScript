import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kris's Script",
  description: "AI chat platform testing the SubScript USDC payment system on Arc",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
