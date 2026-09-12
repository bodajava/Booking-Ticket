import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "./site-header";

/* DESIGN.MD §3 — display / body / mono. Instrument Serif ships weight 400 only. */
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AeroFlow",
  description: "Direct-carrier flight booking — choose your seat, add baggage, fly.",
};

/**
 * Clerk ships an indigo accent by default, which DESIGN.MD §9 rules out
 * ("Add a second accent"). Mapping its variables onto the Vinyl Noir tokens
 * keeps the sign-in card and the avatar inside the system.
 */
const clerkAppearance = {
  variables: {
    colorPrimary: "#ece6dc",
    colorText: "#ece6dc",
    colorTextSecondary: "#8a8278",
    colorBackground: "#1c1815",
    colorInputBackground: "#262220",
    colorInputText: "#ece6dc",
    colorDanger: "#991B1B",
    borderRadius: "10px",
    fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  },
} as const;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-stage text-bone">
        <ClerkProvider appearance={clerkAppearance}>
          <SiteHeader />

          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
