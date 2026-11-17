import { Table } from "@/components/Studio";

export default async function Page({ params }: { params: Promise<{ localId: string }> }) {
  const { localId } = await params;
  return <Table localId={localId} />;
}
