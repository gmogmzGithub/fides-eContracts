import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/landing/wordmark";

export default function InvitacionLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-ivory">
      <header className="bg-carbon px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="w-fit rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <Wordmark tone="light" />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}
