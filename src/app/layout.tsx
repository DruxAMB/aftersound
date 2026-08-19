import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://aftersound-fawn.vercel.app"),
  title: "AfterSound — hear the damage before it happens",
  description:
    "Measure your room, project your hearing, and hear five seconds of your world through your future ears.",
  openGraph: {
    title: "AfterSound — hear the damage before it happens",
    description:
      "Measure your room, project your hearing, and hear five seconds of your world through your future ears.",
    type: "website",
    url: "https://aftersound-fawn.vercel.app",
    siteName: "AfterSound",
    images: ["/og-image.svg"],
  },
  twitter: {
    card: "summary_large_image",
    title: "AfterSound — hear the damage before it happens",
    description:
      "Measure your room, project your hearing, and hear five seconds of your world through your future ears.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
