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
        <Link href="/app/billing" className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50">
          Billing
        </Link>
      </>
    );
  }

  return (
    <>
      <SignedIn>
        <Link href="/app/billing" className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50">
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
        <button className="text-sm px-3 py-1.5 rounded bg-black text-white">Sign in</button>
      </SignInButton>
      <SignUpButton mode="modal" forceRedirectUrl={nextTarget} signInForceRedirectUrl={nextTarget}>
        <button className="text-sm px-3 py-1.5 rounded border">Create account</button>
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