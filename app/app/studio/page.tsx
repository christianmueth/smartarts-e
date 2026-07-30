import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import StudioWorkspace from "@/components/StudioWorkspace";
import { getStudioProjectDetailForClerkUser, listStudioProjectsForClerkUser } from "@/lib/studio";

export const dynamic = "force-dynamic";

export default async function StudioPage({ searchParams }: { searchParams?: Promise<{ project?: string }> }) {
  const { userId } = await auth();
  if (!userId) {
    redirect(`/?next=${encodeURIComponent("/app/studio")}`);
  }

  const projects = await listStudioProjectsForClerkUser(userId);
  const params = await searchParams;
  const initialProjectId = params?.project && projects.some((project) => project.id === params.project)
    ? params.project
    : projects[0]?.id || null;
  const initialProject = initialProjectId
    ? await getStudioProjectDetailForClerkUser(userId, initialProjectId)
    : null;

  return (
    <div className="mx-auto flex max-w-[1480px] flex-col gap-8 p-6">
      <StudioWorkspace initialProjects={projects} initialProjectId={initialProjectId} initialProject={initialProject} />
    </div>
  );
}