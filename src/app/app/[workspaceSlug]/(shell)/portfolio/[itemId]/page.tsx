import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ workspaceSlug: string; itemId: string }>;
}

/**
 * Old address of a Portfolio item (F5a). The item now opens in the drawer
 * of the list (ADR 0015); links from proposals and bookmarks land there.
 */
export default async function PortfolioItemPage({ params }: PageProps) {
  const { workspaceSlug, itemId } = await params;
  redirect(
    `/app/${workspaceSlug}/portfolio?edit=${encodeURIComponent(itemId)}`,
  );
}
