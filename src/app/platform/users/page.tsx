import type { Metadata } from "next";
import { Users } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { listAdminUsers } from "@/core/admin/platform";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platform.users");
  return { title: t("metaTitle") };
}

export default async function AdminUsersPage() {
  const identity = await requirePlatformAdminPage("/platform/users");
  const users = await listAdminUsers(prisma, identity.userId);
  const t = await getTranslations("platform.users");
  const format = await getFormatter();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-on-primary rounded-lg p-2">
            <Users className="h-5 w-5" />
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
            {t("total", { count: users.length })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <Table className="text-12">
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">{t("colName")}</TableHead>
                <TableHead className="px-5">{t("colStatus")}</TableHead>
                <TableHead className="px-5">{t("colCreatedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="px-5">
                    <div className="text-text font-semibold">
                      {u.fullName ?? t("noName")}
                    </div>
                    <div className="text-11 text-text-tertiary font-mono">
                      {u.id}
                    </div>
                  </TableCell>
                  <TableCell className="px-5">
                    <span
                      className={`text-11 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                        u.status === "active"
                          ? "bg-success-bg text-success-text border-success-border border"
                          : "bg-danger-bg text-danger-text border-danger-border border"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          u.status === "active"
                            ? "bg-success-solid"
                            : "bg-danger-solid"
                        }`}
                      />
                      {u.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-text-secondary px-5">
                    {format.dateTime(u.createdAt, { dateStyle: "short" })}
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
