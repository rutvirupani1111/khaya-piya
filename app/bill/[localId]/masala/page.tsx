import { Shelf } from "@/components/Studio";

export default async function Page({ params }: { params: Promise<{ localId: string }> }) {
  const { localId } = await params;
  return <Shelf localId={localId} />;
}
