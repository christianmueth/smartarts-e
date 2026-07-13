import { Suspense } from "react";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import NavBar from "@/components/NavBar";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-cormorant",
  weight: ["400", "500", "600", "700"],
});

export const metadata = {
  title: "SmartArts | AI Art Production",
  description: "SmartArts is focused on AI-enabled art production for concept development, visual iteration, and campaign-ready delivery.",
  icons: {
    icon: "/logo.ico",
    shortcut: "/logo.ico",
    apple: "/logo.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${cormorant.variable} min-h-screen bg-white text-gray-900 antialiased`}>
        <Suspense fallback={null}>
          <NavBar />
        </Suspense>
        {children}
        <Toaster richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
