import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Jost } from "next/font/google";
import "./globals.css";

const display = Bodoni_Moda({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const body = Jost({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Fides",
    template: "%s · Fides",
  },
  description:
    "Plataforma contractual administrada: cada Organización emite sus contratos, los comparte con un enlace y conserva el expediente completo.",
  applicationName: "Fides",
  icons: {
    icon: [
      { url: "/icons/fides-coin-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/fides-coin-64.png", sizes: "64x64", type: "image/png" },
      {
        url: "/icons/fides-coin-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    shortcut: [
      { url: "/icons/fides-coin-64.png", sizes: "64x64", type: "image/png" },
    ],
    apple: [{ url: "/icons/fides-180.png", sizes: "180x180", type: "image/png" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1C1917",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body
        className={`${display.variable} ${body.variable} min-h-dvh bg-ivory font-body text-ink antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
