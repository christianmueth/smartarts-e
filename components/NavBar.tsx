"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import NavBarClerkControls from "@/components/NavBarClerkControls";

export default function NavBar() {
  const pathname = usePathname();

  // The mobile shell owns most /app routes, but Billing retains its full website layout.
  if (pathname.startsWith("/app") && pathname !== "/app/billing") {
    return null;
  }
  return (
    <header className="sticky top-0 z-50 border-b border-pink-200/80 bg-[linear-gradient(90deg,rgba(255,246,205,0.82),rgba(255,235,246,0.84),rgba(255,248,216,0.82))] backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
        <Link href="/" className="flex items-center gap-3 text-lg font-semibold tracking-[-0.02em] text-[#7a1f4f]">
          <Image src="/smartarts-e_logo.png" alt="SmartArts-E" width={96} height={96} className="h-10 w-10 rounded-2xl border border-pink-200 object-cover shadow-[0_10px_24px_rgba(255,170,205,0.28)]" />
          <span>SmartArts-E</span>
        </Link>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-3 text-sm text-pink-600 lg:flex">
            <span className="rounded-full border border-yellow-300 bg-yellow-100/90 px-3 py-1.5 font-medium text-pink-700 shadow-[0_8px_18px_rgba(255,221,102,0.24)]">
              AI Art Production
            </span>
            <span>Concept, generation, and delivery</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <NavBarClerkControls />
          </div>
        </div>
      </nav>
    </header>
  );
}
