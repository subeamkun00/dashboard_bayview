import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { UI_SCALE } from "@/lib/ui-scale";
export const metadata: Metadata = {
  title: "Bayview AI · Admin Dashboard",
  description:
    "Your people, knowledge, and conversations. Connected. The Bayview internal AI assistant workspace.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" style={{ fontSize: `${UI_SCALE * 100}%` }}>
      <body>{children}</body>
    </html>
  );
}
