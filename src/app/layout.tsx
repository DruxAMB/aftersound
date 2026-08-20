import type { Metadata } from "next";
import { Geist, Instrument_Serif, DM_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://aftersound.druxamb.dev"),
  title: "AfterSound — hear the damage before it happens",
  description:
    "Measure your room, project your hearing, and hear five seconds of your world through your future ears.",
  openGraph: {
    title: "AfterSound — hear the damage before it happens",
    description:
      "Measure your room, project your hearing, and hear five seconds of your world through your future ears.",
    type: "website",
    url: "https://aftersound.druxamb.dev",
    siteName: "AfterSound",
    images: ["/og-image.png"],
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
      className={`${geistSans.variable} ${instrumentSerif.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-void-black text-paper-white">
        {children}
      </body>
    </html>
  );
}
