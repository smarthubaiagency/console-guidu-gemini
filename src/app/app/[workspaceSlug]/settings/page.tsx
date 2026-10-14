import { redirect } from "next/navigation";

export default async function WorkspaceSettingsIndex({
  params,
}: Readonly<{ params: Promise<{ workspaceSlug: string }> }>) {
  const { workspaceSlug } = await params;
  redirect(`/app/${workspaceSlug}/settings/general`);
}
