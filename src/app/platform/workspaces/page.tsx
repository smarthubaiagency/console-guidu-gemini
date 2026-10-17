import type { Metadata } from "next";
import { Layers } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { listAdminWorkspaces } from "@/core/admin/platform";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platform.workspaces");
  return { title: t("metaTitle") };
}

export default async function AdminWorkspacesPage() {
  const identity = await requirePlatformAdminPage("/platform/workspaces");
  const workspaces = await listAdminWorkspaces(prisma, identity.userId);
  const t = await getTranslations("platform.workspaces");
  const format = await getFormatter();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-on-primary rounded-lg p-2">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-12 text-text-secondary">{t("description")}</p>
          </div>
        </div>
      </div>

      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border bg-surface-sidebar flex items-center justify-between border-b px-5 py-3.5">
          <span className="text-12 text-text-subtle font-semibold">
            {t("total", { count: workspaces.length })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <Table className="text-12">
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">{t("colWorkspace")}</TableHead>
                <TableHead className="px-5">{t("colSlug")}</TableHead>
                <TableHead className="px-5">{t("colOrganization")}</TableHead>
                <TableHead className="px-5">{t("colStatus")}</TableHead>
                <TableHead className="px-5">{t("colCreatedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((ws) => (
                <TableRow key={ws.id}>
                  <TableCell className="px-5">
                    <div className="text-text font-semibold">{ws.name}</div>
                    <div className="text-11 text-text-tertiary font-mono">
                      {ws.id}
                    </div>
                  </TableCell>
                  <TableCell className="text-text-subtle px-5 font-mono">
                    {ws.slug}
                  </TableCell>
                  <TableCell className="text-text px-5 font-medium">
                    {ws.organizationName}
                  </TableCell>
                  <TableCell className="px-5">
                    {ws.purgeAfter ? (
                      <Badge variant="danger" data-testid="deletion-scheduled">
                        {t("deletionScheduled", {
                          date: format.dateTime(ws.purgeAfter, {
                            day: "2-digit",
                            month: "2-digit",
                            timeZone: "America/Sao_Paulo",
                          }),
                        })}
                      </Badge>
                    ) : (
                      <span className="bg-success-bg text-success-text border-success-border text-11 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium">
                        <span className="bg-success-solid h-1.5 w-1.5 rounded-full" />
                        {ws.status}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-text-secondary px-5">
                    {format.dateTime(ws.createdAt, { dateStyle: "short" })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
