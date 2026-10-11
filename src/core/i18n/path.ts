/** Header set by the proxy with the path of the navigation (I1). */
export const PATH_HEADER = "x-guidu-path";

/** Workspace slug of an `/app/<slug>/…` path (not `/app/account`). */
export function workspaceSlugOf(path: string | null): string | null {
  const slug = /^\/app\/([^/?#]+)/.exec(path ?? "")?.[1];
  return slug && slug !== "account" ? decodeURIComponent(slug) : null;
}
