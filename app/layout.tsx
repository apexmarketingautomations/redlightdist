import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Redlight — Your brand. Your audience. Your business.",
  description: "A white-label subscription platform for independent creators.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
