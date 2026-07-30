"use client";

import Link from "next/link";
import Image from "next/image";
import NavBarClerkControls from "@/components/NavBarClerkControls";

export default function NavBar() {
  return (
    <header className="sticky top-0 z-50 border-b border-stone-200 bg-white/75 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
        <Link href="/" className="flex items-center gap-3 text-lg font-semibold tracking-[-0.02em] text-stone-950">
          <Image src="/smartarts-e_logo.png" alt="SmartArts" width={96} height={96} className="h-10 w-10 rounded-2xl object-cover" />
          <span>SmartArts</span>
        </Link>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-3 text-sm text-stone-600 lg:flex">
            <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 font-medium text-orange-900">
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
