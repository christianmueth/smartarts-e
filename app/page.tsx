import { auth } from "@clerk/nextjs/server";
import HomeStudioMvp from "@/components/HomeStudioMvp";
import { getImageGenerationAccessForClerkUser } from "@/lib/image-generation-access";
import { getStudioProjectDetailForClerkUser, listStudioProjectsForClerkUser } from "@/lib/studio";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { userId } = await auth();
  const projects = userId ? await listStudioProjectsForClerkUser(userId) : [];
  const initialProject = userId && projects[0] ? await getStudioProjectDetailForClerkUser(userId, projects[0].id) : null;
  const generationAccess = userId ? await getImageGenerationAccessForClerkUser(userId) : null;

  return <HomeStudioMvp signedIn={Boolean(userId)} initialProjects={projects} initialProject={initialProject} initialGenerationAccess={generationAccess} />;
}
