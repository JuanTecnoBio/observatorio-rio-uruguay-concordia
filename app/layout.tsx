import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isGitHubPages = process.env.GITHUB_PAGES === "true";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Observatorio del Río Uruguay — Concordia",
    template: "%s · Observatorio del Río Uruguay",
  },
  description:
    "Nivel del río Uruguay en Concordia, datos de Salto Grande, señales de cuenca y escenarios de 30 días.",
  applicationName: "Observatorio del Río Uruguay",
  manifest: `${publicBasePath}/manifest.webmanifest`,
  openGraph: {
    title: "Observatorio del Río Uruguay — Concordia",
    description:
      "Estado hidrológico, fuentes oficiales y criterios de incertidumbre para Concordia.",
    type: "website",
    locale: "es_AR",
  },
  twitter: {
    card: "summary",
    title: "Observatorio del Río Uruguay — Concordia",
    description:
      "Estado hidrológico, fuentes oficiales y criterios de incertidumbre para Concordia.",
  },
  other: isGitHubPages ? undefined : { "codex-preview": "development" },
  icons: {
    icon: `${publicBasePath}/favicon.svg`,
    shortcut: `${publicBasePath}/favicon.svg`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
