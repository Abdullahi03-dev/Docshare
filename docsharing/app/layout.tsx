import type { Metadata, Viewport } from "next";
import {
  Inter,
  Space_Grotesk,
  Instrument_Serif,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const grotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Docshare — Send files. Simply.",
  description:
    "Pick a file, get a link. No accounts, no clutter. Private transfers that auto-delete in 30 minutes.",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "Docshare — Send files. Simply.",
    description:
      "Drop a file, get a link. No accounts, no clutter. Auto-deleted in 30 minutes.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

function themeInit() {
  return `(function(){try{var t=localStorage.getItem('docshare-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${grotesk.variable} ${instrument.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit() }} />
      </head>
      <body className="min-h-full bg-white font-sans text-zinc-950 dark:bg-[#0a0a0a] dark:text-zinc-50">
        {children}
      </body>
    </html>
  );
}
