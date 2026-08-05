"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function MobileAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (pathname === "/app/billing") {
    return <>{children}</>;
  }

  const navItems = [
    { label: "Create", href: "/app/create", emoji: "🎨" },
    { label: "Gallery", href: "/app/gallery", emoji: "🖼️" },
    { label: "Account", href: "/app/account", emoji: "👤" },
  ];

  return (
    <div className="min-h-dvh bg-gray-50 pb-20">
      <header className="sticky top-0 z-40 border-b bg-white/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-bold text-[#7a1f4f]">SmartArts-E</h1>
      </header>

      <main className="mx-auto w-full max-w-md p-4">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t bg-white pb-safe pt-2 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 p-2 ${isActive ? 'text-pink-600' : 'text-gray-500'}`}
            >
              <span className="text-xl">{item.emoji}</span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
