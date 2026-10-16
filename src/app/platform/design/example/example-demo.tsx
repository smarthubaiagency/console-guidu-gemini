"use client";

import {
  AlignJustify,
  Bot,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileText,
  Flame,
  Info,
  LayoutGrid,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  Plus,
  Presentation,
  Send,
  Settings,
  Share2,
  Sparkles,
  UserPlus,
  Users,
  Video,
  Wallet,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Amount } from "@/components/patterns/amount";
import { FieldCard } from "@/components/patterns/field-card";
import { KeyValueList } from "@/components/patterns/key-value-list";
import { PageCanvas } from "@/components/patterns/page-canvas";
import { PageTitle } from "@/components/patterns/page-title";
import { SectionHeader } from "@/components/patterns/section-header";
import { StatCard } from "@/components/patterns/stat-card";
import { StatGroup } from "@/components/patterns/stat-group";
import { TagList } from "@/components/patterns/tag-list";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const TABS = [
  { value: "overview", icon: LayoutGrid },
  { value: "audience", icon: Users },
  { value: "results", icon: Presentation },
  { value: "settings", icon: Settings },
] as const;

const MESSAGES = [
  { id: "welcome", status: "neutral" },
  { id: "why", status: "success" },
  { id: "trust", status: "success" },
  { id: "launch", status: "warning" },
] as const;

const LEADS = [
  { id: "ana", temperature: "success" },
  { id: "bruno", temperature: "warning" },
  { id: "carla", temperature: "neutral" },
] as const;

const ATTACHMENTS = [
  { name: "catalogo-loja-centro.pdf", icon: FileText },
  { name: "apresentacao-da-loja.mp4", icon: Video },
  { name: "tabela-de-precos.pdf", icon: FileText },
] as const;

const TAGS = [
  "#novovisitante",
  "#parceiro",
  "#duvida",
  "#promocao",
  "#vip",
  "#retorno",
  "#indicacao",
];

/**
 * The model page (U4, ADR 0021): the structure of the two reference pages
 * Marcelo chose, rebuilt only with the model components and GUIDU sample
 * data (a GUIDS overview).
 */
export function ExampleDemo() {
  const t = useTranslations("designLab.example");
  const locale = useLocale();
  const [tags, setTags] = useState(TAGS);
  const [period, setPeriod] = useState("30d");

  return (
    <PageCanvas>
      <PageTitle
        icon={<Bot className="size-6" />}
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            <Button variant="outline">
              <Download />
              {t("download")}
            </Button>
            <Button>
              <Share2 />
              {t("share")}
            </Button>
            <Button variant="outline" size="icon" aria-label={t("more")}>
              <MoreHorizontal />
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card variant="panel" className="min-w-0 px-4 sm:px-6 xl:col-span-2">
          <Tabs defaultValue="overview" className="gap-6">
            <TabsList variant="segmented" className="w-full">
              {TABS.map(({ value, icon: Icon }) => (
                <TabsTrigger key={value} value={value}>
                  <Icon />
                  <span className="max-sm:sr-only">{t(`tabs.${value}`)}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="overview" className="flex flex-col gap-8">
              <div
                className="grid gap-4 md:grid-cols-3"
                data-testid="example-stats"
              >
                <StatCard
                  variant="flush"
                  icon={<MessageCircle className="size-4" />}
                  label={t("stats.conversations")}
                  value="1.284"
                  caption={t("stats.conversationsCaption")}
                />
                <StatCard
                  variant="flush"
                  icon={<Flame className="size-4" />}
                  label={t("stats.hotLeads")}
                  value={<span className="text-success-text">+86</span>}
                  caption={t("stats.hotLeadsCaption")}
                />
                <StatCard
                  variant="flush"
                  icon={<Wallet className="size-4" />}
                  label={t("stats.sales")}
                  value={
                    <Amount value={13066.6} locale={locale} currency="BRL" />
                  }
                  caption={t("stats.salesCaption")}
                />
              </div>

              <section className="flex flex-col gap-4">
                <SectionHeader
                  title={t("messages.title")}
                  description={t("messages.description")}
                  actions={
                    <Button variant="outline" size="sm">
                      {t("viewMore")}
                      <ChevronRight />
                    </Button>
                  }
                />
                <Accordion
                  type="single"
                  collapsible
                  variant="cards"
                  defaultValue="why"
                  data-testid="example-messages"
                >
                  {MESSAGES.map((message) => (
                    <AccordionItem key={message.id} value={message.id}>
                      <AccordionTrigger>
                        <span className="flex min-w-0 flex-1 items-center gap-3">
                          <AlignJustify
                            aria-hidden
                            className="text-text-secondary size-4 shrink-0"
                          />
                          <span className="min-w-0 truncate">
                            {t(`messages.items.${message.id}`)}
                          </span>
                          <Badge variant={message.status}>
                            {t(`messages.status.${message.status}`)}
                          </Badge>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="flex flex-col gap-4">
                        <StatGroup
                          items={[
                            {
                              label: t("messages.sent"),
                              value: "132",
                              icon: <Send className="size-4" />,
                            },
                            {
                              label: t("messages.read"),
                              value: "110",
                              icon: <Eye className="size-4" />,
                            },
                            {
                              label: t("messages.replied"),
                              value: "64",
                              icon: <MessagesSquare className="size-4" />,
                            },
                            {
                              label: t("messages.newLeads"),
                              value: "18",
                              icon: <UserPlus className="size-4" />,
                            },
                          ]}
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-14 text-text-secondary">
                            {t("messages.audience")}
                          </span>
                          <TagList
                            tags={tags}
                            max={3}
                            onRemove={(tag) =>
                              setTags((list) => list.filter((x) => x !== tag))
                            }
                            removeLabel={(tag) => t("removeTag", { tag })}
                            moreLabel={(count) => t("moreTags", { count })}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </section>

              <InputGroup className="rounded-card">
                <InputGroupTextarea
                  aria-label={t("composer.label")}
                  placeholder={t("composer.placeholder")}
                  className="min-h-24"
                />
                <InputGroupAddon align="block-end" className="flex-wrap gap-2">
                  <InputGroupButton variant="outline" size="sm">
                    <Plus />
                    {t("composer.attach")}
                  </InputGroupButton>
                  <InputGroupButton variant="outline" size="sm">
                    <Sparkles />
                    {t("composer.askAi")}
                  </InputGroupButton>
                  <InputGroupButton
                    variant="default"
                    size="sm"
                    className="ml-auto"
                  >
                    {t("composer.create")}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>

              <section className="flex flex-col gap-4">
                <SectionHeader
                  title={t("leads.title")}
                  description={t("leads.description")}
                />
                <Table variant="soft" data-testid="example-leads">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("leads.name")}</TableHead>
                      <TableHead>{t("leads.interest")}</TableHead>
                      <TableHead>{t("leads.temperature")}</TableHead>
                      <TableHead>{t("leads.value")}</TableHead>
                      <TableHead>
                        <span className="sr-only">{t("leads.open")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {LEADS.map((lead, index) => (
                      <TableRow key={lead.id}>
                        <TableCell className="font-medium">
                          {t(`leads.rows.${lead.id}.name`)}
                        </TableCell>
                        <TableCell>
                          {t(`leads.rows.${lead.id}.interest`)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={lead.temperature}>
                            {t(`leads.temperatures.${lead.temperature}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Amount
                            value={[2480.9, 860, 129.5][index] ?? 0}
                            locale={locale}
                            currency="BRL"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label={t("leads.openLead", {
                              name: t(`leads.rows.${lead.id}.name`),
                            })}
                          >
                            <ChevronRight />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            </TabsContent>

            {TABS.slice(1).map(({ value, icon: Icon }) => (
              <TabsContent key={value} value={value}>
                <Empty className="bg-surface-inset rounded-inner">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Icon />
                    </EmptyMedia>
                    <EmptyTitle>{t("empty.title")}</EmptyTitle>
                    <EmptyDescription>
                      {t("empty.description")}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TabsContent>
            ))}
          </Tabs>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card variant="surface">
            <CardHeader>
              <CardTitle className="text-16">{t("channel.title")}</CardTitle>
              <CardDescription>{t("channel.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldCard
                icon={<MessageCircle />}
                label={t("channel.inbox")}
                value="Loja Centro · +55 11 99999-0000"
                action={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={t("channel.copy")}
                  >
                    <Copy />
                  </Button>
                }
              />
            </CardContent>
          </Card>

          <Card variant="surface">
            <CardHeader>
              <CardTitle className="text-16">
                {t("performance.title")}
              </CardTitle>
              <CardAction>
                <ToggleGroup
                  type="single"
                  variant="segmented"
                  size="sm"
                  value={period}
                  onValueChange={(value) => value && setPeriod(value)}
                  aria-label={t("performance.period")}
                >
                  {(["7d", "30d", "year"] as const).map((value) => (
                    <ToggleGroupItem key={value} value={value}>
                      {t(`performance.periods.${value}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <StatCard
                variant="plain"
                label={t("performance.answered")}
                value="94%"
                caption={t("performance.answeredCaption")}
                className="bg-surface-inset border-0 shadow-none"
              />
              <KeyValueList
                items={[
                  { label: t("performance.responseTime"), value: "38 s" },
                  { label: t("performance.handoffs"), value: "12%" },
                  {
                    label: t("performance.aiCost"),
                    value: (
                      <Amount value={84.2} locale={locale} currency="BRL" />
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>

          <Card variant="surface">
            <CardHeader>
              <CardTitle className="text-16">
                {t("attachments.title")}
              </CardTitle>
              <CardAction>
                <Button variant="outline" size="sm">
                  {t("viewMore")}
                  <ChevronRight />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <ItemGroup className="gap-2">
                {ATTACHMENTS.map(({ name, icon: Icon }) => (
                  <Item key={name} variant="card" size="sm" role="listitem">
                    <ItemMedia>
                      <Icon className="text-text-secondary size-4" />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="block w-full truncate">
                        {name}
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("attachments.details", { name })}
                      >
                        <Info />
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageCanvas>
  );
}
