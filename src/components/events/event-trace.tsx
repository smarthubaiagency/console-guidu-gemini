import { getFormatter, getTranslations } from "next-intl/server";

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
import type { EventTrace } from "@/core/events/views";

const DELIVERY_BADGE: Record<
  string,
  "success" | "danger" | "warning" | "neutral" | "info"
> = {
  sent: "success",
  delivered: "success",
  read: "success",
  failed: "danger",
  blocked_policy: "danger",
  skipped: "warning",
  pending: "neutral",
  queued: "info",
};

const KNOWN_STATUSES = [
  "sent",
  "delivered",
  "read",
  "failed",
  "blocked_policy",
  "skipped",
  "pending",
  "queued",
] as const;

/**
 * The trace of an event (H2, gap "Rastro completo de um evento"): who was
 * told, on which channel and with which outcome (the bell included), what
 * was audited and who saw the data, as the reader's level may see it.
 * `names` resolves people the reader may know (the customer's team).
 */
export async function EventTraceCards({
  trace,
  names,
  deliveries = true,
}: Readonly<{
  trace: EventTrace;
  names?: ReadonlyMap<string, string>;
  /** False when the page shows the deliveries itself (Plataforma, H1). */
  deliveries?: boolean;
}>) {
  const t = await getTranslations("eventRules.trace");
  const format = await getFormatter();
  const when = (date: Date) =>
    format.dateTime(date, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    });
  const person = (id: string | null) =>
    id ? (names?.get(id) ?? t("person")) : null;
  const statusOf = (status: string) =>
    (KNOWN_STATUSES as readonly string[]).includes(status)
      ? t(`status.${status as (typeof KNOWN_STATUSES)[number]}`)
      : status;

  return (
    <>
      {deliveries ? (
      <Card variant="surface" className="px-4" data-testid="event-trace-deliveries">
        <CardHeader className="px-0">
          <CardTitle>{t("deliveries")}</CardTitle>
          <CardDescription>{t("deliveriesHint")}</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {trace.deliveries.length === 0 ? (
            <p className="text-12 text-text-secondary">{t("noDeliveries")}</p>
          ) : (
            <ItemGroup className="gap-2">
              {trace.deliveries.map((delivery) => (
                <Item
                  key={`${delivery.channel}-${delivery.id}`}
                  variant="inset"
                  size="sm"
                  data-testid="event-trace-delivery"
                  data-channel={delivery.channel}
                  data-status={delivery.status}
                >
                  <ItemContent>
                    <ItemTitle>
                      {t(`channels.${delivery.channel as "email"}`)}
                    </ItemTitle>
                    <ItemDescription>
                      {[
                        person(delivery.recipientUserId),
                        delivery.holdReason
                          ? t(`hold.${delivery.holdReason as "digest"}`, {
                              date: delivery.deliverAfter
                                ? when(delivery.deliverAfter)
                                : "-",
                            })
                          : null,
                        delivery.reason && !delivery.holdReason
                          ? delivery.reason
                          : null,
                        when(delivery.updatedAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant={DELIVERY_BADGE[delivery.status] ?? "neutral"}>
                      {statusOf(delivery.status)}
                    </Badge>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
      ) : null}

      {trace.viewer !== "partner_situation" ? (
        <Card variant="surface" className="px-4" data-testid="event-trace-audit">
          <CardHeader className="px-0">
            <CardTitle>{t("audit")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {trace.audit.length === 0 ? (
              <p className="text-12 text-text-secondary">{t("noAudit")}</p>
            ) : (
              <ItemGroup className="gap-2">
                {trace.audit.map((row) => (
                  <Item key={row.id} variant="inset" size="sm">
                    <ItemContent>
                      <ItemTitle className="font-mono">{row.action}</ItemTitle>
                      <ItemDescription>
                        {[person(row.actorUserId), row.origin, when(row.occurredAt)]
                          .filter(Boolean)
                          .join(" · ")}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant={row.result === "success" ? "success" : "danger"}>
                        {row.result}
                      </Badge>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </CardContent>
        </Card>
      ) : null}

      {trace.viewer !== "partner_situation" ? (
        <Card variant="surface" className="px-4" data-testid="event-trace-views">
          <CardHeader className="px-0">
            <CardTitle>{t("views")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {trace.views.length === 0 ? (
              <p className="text-12 text-text-secondary">{t("noViews")}</p>
            ) : (
              <ItemGroup className="gap-2">
                {trace.views.map((view, index) => (
                  <Item
                    key={`${view.accessGrantId}-${index}`}
                    variant="inset"
                    size="sm"
                    data-testid="event-data-view"
                  >
                    <ItemContent>
                      <ItemTitle>
                        {t("viewedBy", {
                          who:
                            view.requesterKind === "platform"
                              ? t("platformSupport")
                              : (view.requesterLabel ?? t("partnerSupport")),
                          by: person(view.decidedBy) ?? t("person"),
                        })}
                      </ItemTitle>
                      <ItemDescription>{when(view.viewedAt)}</ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
