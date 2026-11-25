import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Ledger } from "@/components/khata/Ledger";
import { getGroup } from "@/lib/db/tenant";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "KhayaPiya: khata", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/khata/${groupId}`)}`);
  // getGroup checks the membership first: someone else's tiffin is simply not found
  const group = await getGroup(user.id, groupId);
  if (!group) notFound();
  return <Ledger initial={group} />;
}
