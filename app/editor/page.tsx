import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import EasyEaselEditor from "@/components/EasyEaselEditor";
import { getImageGenerationAccessForClerkUser } from "@/lib/image-generation-access";
import { getEditorProjectForClerkUser, listEditorAssetsForClerkUser, listEditorProjectsForClerkUser } from "@/lib/easy-easel";

export const dynamic = "force-dynamic";

export default async function EditorPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/?next=%2Feditor");
  }

  const generationAccess = await getImageGenerationAccessForClerkUser(userId);
  if (!generationAccess.canGenerate) {
    redirect("/app/billing?reason=image-generation-limit");
  }

  const projects = await listEditorProjectsForClerkUser(userId);
  const initialProject = projects[0]
    ? await getEditorProjectForClerkUser(userId, projects[0].id)
    : null;
  const assets = await listEditorAssetsForClerkUser(userId);

  return <EasyEaselEditor initialAssets={assets} initialProjects={projects} initialProject={initialProject} />;
}
