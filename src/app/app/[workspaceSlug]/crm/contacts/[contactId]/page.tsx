import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ workspaceSlug: string; contactId: string }>;
}

/**
 * Old address of a contact (F4c). The contact now opens in the drawer of the
 * list (ADR 0015); links from proposals and bookmarks land there.
 */
export default async function CrmContactPage({ params }: PageProps) {
  const { workspaceSlug, contactId } = await params;
  redirect(
    `/app/${workspaceSlug}/crm/contacts?edit=${encodeURIComponent(contactId)}`,
  );
}
