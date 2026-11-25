import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OrderPad } from "@/components/khata/OrderPad";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "KhayaPiya: order pad", robots: { index: false } };

const safeNext = (n: string | undefined) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/khata");

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pb-16 pt-4">
      <Link href="/" className="tap press inline-flex items-center gap-1 text-sm font-semibold underline-offset-4 hover:underline">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        Counter
      </Link>
      <OrderPad next={next} />
    </main>
  );
}
