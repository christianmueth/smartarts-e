import { Suspense } from "react";
import { ClerkProvider } from "@clerk/nextjs";
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
  title: "SmartArts-E",
  description: "SmartArts is focused on AI-enabled art production for concept development, visual iteration, and campaign-ready delivery.",
  icons: {
    icon: "/smartarts-e_logo.png",
    shortcut: "/smartarts-e_logo.png",
    apple: "/smartarts-e_logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const body = (
    <body className={`${manrope.variable} ${cormorant.variable} min-h-screen bg-white text-gray-900 antialiased`}>
      <Suspense fallback={null}>
        <NavBar />
      </Suspense>
      {children}
      <Toaster richColors closeButton position="top-right" />
    </body>
  );

  return (
    <html lang="en">
      {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
        <ClerkProvider>
          {body}
        </ClerkProvider>
      ) : body}
    </html>
  );
}
