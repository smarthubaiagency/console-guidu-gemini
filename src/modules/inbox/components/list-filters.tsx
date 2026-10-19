"use client";

import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { INBOX_VIEWS, type InboxView } from "../views";

/**
 * The two selectors above the search of the list (IN4c): the type of
 * conversation, which is the view the narrow bar chose before, and the
 * channels, which only holds the place until there is a channel filter.
 */
export function ListFilters({
  view,
  counts,
  onView,
}: Readonly<{
  view: InboxView;
  counts: Readonly<Record<InboxView, number>> | null;
  onView: (view: InboxView) => void;
}>) {
  const t = useTranslations("inbox");
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select
        value={view}
        onValueChange={(value) => onView(value as InboxView)}
      >
        <SelectTrigger
          size="sm"
          className="w-full"
          aria-label={t("filters.type")}
          data-testid="inbox-view-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INBOX_VIEWS.map((key) => (
            <SelectItem key={key} value={key}>
              <span>{t(`views.${key}`)}</span>
              {counts && key !== "resolved" ? (
                <span className="text-text-tertiary tabular-nums">
                  {counts[key]}
                </span>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value="all" disabled>
        <SelectTrigger
          size="sm"
          className="w-full"
          aria-label={t("filters.channels")}
          title={t("filters.channelsSoon")}
          data-testid="inbox-channel-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filters.allChannels")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
