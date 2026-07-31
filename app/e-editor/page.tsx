import { auth } from "@clerk/nextjs/server";
import EEditorWorkspace from "@/components/EEditorWorkspace";
import { listEditorAssetsForClerkUser } from "@/lib/easy-easel";

export const dynamic = "force-dynamic";

export default async function EEditorPage() {
  const { userId } = await auth();
  const initialAssets = userId ? await listEditorAssetsForClerkUser(userId) : [];

  return <EEditorWorkspace initialAssets={initialAssets} />;
}