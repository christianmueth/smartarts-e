"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

const hasClerkClient = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function NavBarClerkControls() {
  if (!hasClerkClient) {
    return (
      <>
        <Link href="/easy-easel" className="rounded-full border border-pink-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-pink-700 hover:bg-pink-50">
          Easy Easel
        </Link>
        <Link href="/app/billing" className="rounded-full border border-pink-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-pink-700 hover:bg-pink-50">
          Billing
        </Link>
      </>
    );
  }

  return (
    <>
      <SignedIn>
        <Link href="/easy-easel" className="rounded-full border border-pink-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-pink-700 hover:bg-pink-50">
          Easy Easel
        </Link>
        <Link href="/library" className="rounded-full border border-pink-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-pink-700 hover:bg-pink-50">
          Library
        </Link>
        <Link href="/app/billing" className="rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-sm font-medium text-yellow-900 hover:bg-yellow-100">
          Billing
        </Link>
      </SignedIn>

      <Suspense fallback={<SignedOutAuthButtons nextTarget="/app" />}>
        <SignedOutAuthButtonsFromLocation />
      </Suspense>

      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </>
  );
}

function SignedOutAuthButtonsFromLocation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nextTarget = buildAuthRedirectTarget(pathname, searchParams);
  return <SignedOutAuthButtons nextTarget={nextTarget} />;
}

function SignedOutAuthButtons({ nextTarget }: { nextTarget: string }) {
  return (
    <SignedOut>
      <SignInButton mode="modal" forceRedirectUrl={nextTarget} signUpForceRedirectUrl={nextTarget}>
        <button className="rounded-full bg-[linear-gradient(135deg,#ff5fb2,#ff8a5b)] px-3 py-1.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,95,178,0.28)]">Sign in</button>
      </SignInButton>
      <SignUpButton mode="modal" forceRedirectUrl={nextTarget} signInForceRedirectUrl={nextTarget}>
        <button className="rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-sm font-medium text-yellow-900">Create account</button>
      </SignUpButton>
    </SignedOut>
  );
}

function buildAuthRedirectTarget(
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>
) {
  if (pathname === "/") {
    const requestedTarget = searchParams.get("next");
    return normalizeNextTarget(requestedTarget);
  }

  const query = searchParams.toString();
  return normalizeNextTarget(query ? `${pathname}?${query}` : pathname);
}

function normalizeNextTarget(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("/")) return "/";
  if (trimmed.startsWith("//")) return "/";
  return trimmed;
}