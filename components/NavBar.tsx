"use client";

import Link from "next/link";

export default function NavBar() {
  return (
    <header className="sticky top-0 z-50 border-b border-stone-200 bg-white/75 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
        <Link href="/" className="text-lg font-semibold tracking-[-0.02em] text-stone-950">
          SmartArts
        </Link>

        <div className="flex items-center gap-3 text-sm text-stone-600">
          <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 font-medium text-orange-900">
            AI Art Production
          </span>
          <span>Concept, generation, and delivery</span>
        </div>
      </nav>
    </header>
  );
}
