import type { Metadata } from "next";
import { Users } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { getPlatformAdminMember, listAdminUsers } from "@/core/admin/platform";
import { KeychainSwitch } from "@/components/events/keychain-switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { platformTeam, type TeamMember } from "@/core/events/platform";
import { hasPlatformRolePermission } from "@/core/permissions/matrix";
import { Permissions } from "@/core/permissions/catalog";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
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
  const te = await getTranslations("events.team");
  const format = await getFormatter();
  // The platform team and full access (keychain, H1): the owner only.
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  let team: TeamMember[] | null = null;
  if (
    role &&
    hasPlatformRolePermission(role, Permissions.PLATFORM_CAPABILITIES_MANAGE)
  ) {
    team = await withIdentityContext(prisma, identity.userId, (tx) =>
      platformTeam(tx, { userId: identity.userId, platformRole: role }),
    );
  }

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

      {team ? (
        <Card
          variant="panel"
          className="px-4 sm:px-6"
          data-testid="platform-team"
        >
          <CardHeader className="px-0">
            <CardTitle>{te("title")}</CardTitle>
            <CardDescription>{te("description")}</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <ItemGroup className="gap-2">
              {team.map((member) => {
                const name = member.fullName ?? te("noName");
                return (
                  <Item
                    key={member.userId}
                    variant="card"
                    size="sm"
                    data-testid="platform-team-member"
                  >
                    <ItemContent>
                      <ItemTitle>{name}</ItemTitle>
                      <ItemDescription className="font-mono">
                        {member.userId}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant="neutral">
                        {te(`roles.${member.role as "owner"}`)}
                      </Badge>
                      <Badge
                        variant={
                          member.status === "active" ? "success" : "danger"
                        }
                      >
                        {member.status === "active"
                          ? te("active")
                          : te("inactive")}
                      </Badge>
                      <span className="text-12 text-text-secondary">
                        {te("colKeychain")}
                      </span>
                      <KeychainSwitch
                        userId={member.userId}
                        enabled={member.keychain}
                        label={te("keychainLabel", { name })}
                      />
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
