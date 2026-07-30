"use client";

import Link from "next/link";
import { SignInButton, SignUpButton, SignedIn, SignedOut } from "@clerk/nextjs";

const hasClerkClient = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function HomeClerkAuthControls({ nextTarget }: { nextTarget: string }) {
  if (!hasClerkClient) {
    return (
      <>
        <Link href="/sign-up" className="rounded-full bg-black px-6 py-3 text-sm font-medium text-white hover:opacity-90">
          Start the studio
        </Link>
        <Link href="/sign-in" className="rounded-full border border-gray-300 px-6 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <SignedOut>
        <SignUpButton
          mode="modal"
          forceRedirectUrl={nextTarget}
          signInForceRedirectUrl={nextTarget}
        >
          <button className="rounded-full bg-black px-6 py-3 text-sm font-medium text-white hover:opacity-90">
            Start the studio
          </button>
        </SignUpButton>
        <SignInButton
          mode="modal"
          forceRedirectUrl={nextTarget}
          signUpForceRedirectUrl={nextTarget}
        >
          <button className="rounded-full border border-gray-300 px-6 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
            Sign in
          </button>
        </SignInButton>
      </SignedOut>

      <SignedIn>
        <Link
          href="/app/studio"
          className="rounded-full bg-black px-6 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          Open studio
        </Link>
      </SignedIn>
    </>
  );
}