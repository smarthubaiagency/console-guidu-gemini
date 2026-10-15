import { getFormatter, getTranslations } from "next-intl/server";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { KeyUsageView } from "@/core/api/settings";

/**
 * Usage per API key (CF6b): calls and errors of each key in the window,
 * then the totals per day. Shared by /platform (every workspace, with
 * where each key lives) and /app (the keys the member sees).
 */
export async function KeyUsageTables({
  usage,
  showWhere,
}: Readonly<{ usage: KeyUsageView; showWhere: boolean }>) {
  const t = await getTranslations("apiSettings");
  const format = await getFormatter();
  if (usage.keys.length === 0) {
    return (
      <p className="text-12 text-text-secondary" data-testid="key-usage-empty">
        {t("usage.empty", { days: usage.days })}
      </p>
    );
  }
  return (
    <div className="space-y-6">
      <Table data-testid="key-usage">
        <TableHeader>
          <TableRow>
            <TableHead>{t("usage.key")}</TableHead>
            {showWhere ? <TableHead>{t("usage.where")}</TableHead> : null}
            <TableHead className="text-right">{t("usage.calls")}</TableHead>
            <TableHead className="text-right">{t("usage.mcpCalls")}</TableHead>
            <TableHead className="text-right">{t("usage.errors")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usage.keys.map((key) => (
            <TableRow
              key={key.apiKeyId}
              data-testid={`key-usage-${key.prefix}`}
            >
              <TableCell className="whitespace-normal">
                <span className="text-text font-medium">{key.name}</span>{" "}
                <code className="text-11 text-text-subtle">{key.prefix}</code>
                {key.status !== "active" ? (
                  <span className="text-12 text-text-secondary">
                    {" "}
                    · {t("usage.revoked")}
                  </span>
                ) : null}
              </TableCell>
              {showWhere ? (
                <TableCell className="text-12 text-text-secondary whitespace-normal">
                  {[key.organizationName, key.workspaceName]
                    .filter(Boolean)
                    .join(" › ")}
                </TableCell>
              ) : null}
              <TableCell className="text-right" data-testid="key-usage-calls">
                {format.number(key.calls)}
              </TableCell>
              <TableCell className="text-right">
                {format.number(key.mcpCalls)}
              </TableCell>
              <TableCell className="text-right" data-testid="key-usage-errors">
                {format.number(key.errors)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Table data-testid="key-usage-days">
        <TableHeader>
          <TableRow>
            <TableHead>{t("usage.day")}</TableHead>
            <TableHead className="text-right">{t("usage.calls")}</TableHead>
            <TableHead className="text-right">{t("usage.errors")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usage.byDay.map((day) => (
            <TableRow key={day.day}>
              <TableCell>
                {format.dateTime(new Date(`${day.day}T12:00:00Z`), {
                  dateStyle: "short",
                })}
              </TableCell>
              <TableCell className="text-right">
                {format.number(day.calls)}
              </TableCell>
              <TableCell className="text-right">
                {format.number(day.errors)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
