import { auth } from "@clerk/nextjs/server";
import EEditorWorkspace from "@/components/EEditorWorkspace";
import { listSavedStudioAssetsForClerkUser } from "@/lib/studio";

export const dynamic = "force-dynamic";

export default async function EEditorPage() {
  const { userId } = await auth();
  let initialAssets = [];
  if (userId) {
    try {
      initialAssets = await listSavedStudioAssetsForClerkUser(userId);
    } catch {
      // The editor remains usable when the optional asset archive is unavailable.
    }
  }

  return <EEditorWorkspace initialAssets={initialAssets} />;
}