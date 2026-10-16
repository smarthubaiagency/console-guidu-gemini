import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ workspaceSlug: string; recordId: string }>;
}

/**
 * Old address of a record. The record now opens in the drawer of the list
 * (ADR 0015); bookmarks land there.
 */
export default async function HelloWorldRecordPage({ params }: PageProps) {
  const { workspaceSlug, recordId } = await params;
  redirect(
    `/app/${workspaceSlug}/hello-world/records?edit=${encodeURIComponent(recordId)}`,
  );
}
