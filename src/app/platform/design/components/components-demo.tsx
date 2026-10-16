"use client";

import {
  AlignJustify,
  Copy,
  Eye,
  FileText,
  Inbox,
  Info,
  Send,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "link",
  "destructive",
] as const;

const BADGE_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "destructive",
] as const;

const STATUS_VARIANTS = [
  "success",
  "warning",
  "danger",
  "info",
  "neutral",
] as const;

const CARD_VARIANTS = ["surface", "panel", "inset", "framed"] as const;

const SAMPLE_ROWS = [
  { name: "Maria Souza", plan: "Pro", status: "active" },
  { name: "João Lima", plan: "Start", status: "trial" },
  { name: "Ana Reis", plan: "Pro", status: "paused" },
] as const;

/**
 * Catalogue of the shadcn components (ADR 0014) and of the model
 * components built on them (U4, ADR 0021), for visual approval and as the
 * reference when building a screen. Built with the model cards itself.
 */
export function ComponentsDemo() {
  const t = useTranslations("designLab.components");
  const locale = useLocale();
  const [tags, setTags] = useState([
    "#novovisitante",
    "#parceiro",
    "#duvida",
    "#vip",
    "#retorno",
  ]);

  return (
    <PageCanvas>
      <PageTitle title={t("title")} description={t("subtitle")} />
      <Item variant="inset" size="sm" role="note">
        <ItemMedia>
          <Info className="text-info-text size-4" />
        </ItemMedia>
        <ItemContent>
          <ItemDescription>{t("sampleNotice")}</ItemDescription>
        </ItemContent>
      </Item>

      <SectionHeader
        title={t("sections.base")}
        description={t("sections.baseHint")}
      />

      <Group
        id="buttons"
        title={t("groups.buttons")}
        hint={t("hints.buttons")}
        code="@/components/ui/button"
      >
        <div className="flex flex-wrap gap-2">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {t(`variants.${variant}`)}
            </Button>
          ))}
          <Button disabled>{t("variants.disabled")}</Button>
          <Button variant="outline" size="icon" aria-label={t("variants.icon")}>
            <Copy />
          </Button>
        </div>
      </Group>

      <Group
        id="fields"
        title={t("groups.fields")}
        hint={t("hints.fields")}
        code="@/components/ui/input · label · textarea"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="demo-name">{t("field.name")}</Label>
            <Input id="demo-name" placeholder={t("field.namePlaceholder")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="demo-email">{t("field.email")}</Label>
            <Input
              id="demo-email"
              type="email"
              aria-invalid
              defaultValue="maria@"
              aria-describedby="demo-email-error"
            />
            <p id="demo-email-error" className="text-12 text-danger-text">
              {t("field.emailError")}
            </p>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="demo-notes">{t("field.notes")}</Label>
            <Textarea
              id="demo-notes"
              placeholder={t("field.notesPlaceholder")}
            />
          </div>
        </div>
      </Group>

      <Group
        id="selects"
        title={t("groups.selects")}
        hint={t("hints.selects")}
        code="@/components/ui/native-select · select"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="demo-native">{t("field.planNative")}</Label>
            <NativeSelect
              id="demo-native"
              defaultValue="pro"
              className="w-full"
            >
              <NativeSelectOption value="start">Start</NativeSelectOption>
              <NativeSelectOption value="pro">Pro</NativeSelectOption>
              <NativeSelectOption value="scale">Scale</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="demo-select">{t("field.planRich")}</Label>
            <Select defaultValue="pro">
              <SelectTrigger id="demo-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="start">Start</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="scale">Scale</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Group>

      <Group
        id="choices"
        title={t("groups.choices")}
        hint={t("hints.choices")}
        code="@/components/ui/checkbox · switch · radio-group"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-2">
            <Checkbox id="demo-check" defaultChecked />
            <Label htmlFor="demo-check">{t("field.check")}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="demo-switch" defaultChecked />
            <Label htmlFor="demo-switch">{t("field.switch")}</Label>
          </div>
          <RadioGroup defaultValue="email" aria-label={t("field.channel")}>
            {(["email", "whatsapp"] as const).map((value) => (
              <div key={value} className="flex items-center gap-2">
                <RadioGroupItem value={value} id={`demo-radio-${value}`} />
                <Label htmlFor={`demo-radio-${value}`}>
                  {t(`field.channels.${value}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      </Group>

      <Group
        id="tabs"
        title={t("groups.tabs")}
        hint={t("hints.tabs")}
        code="@/components/ui/tabs · @/components/ui/toggle-group"
      >
        <Tabs defaultValue="overview">
          <TabsList variant="segmented">
            <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
            <TabsTrigger value="settings">{t("tabs.settings")}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-14 text-text-secondary">
            {t("tabs.overviewBody")}
          </TabsContent>
          <TabsContent value="settings" className="text-14 text-text-secondary">
            {t("tabs.settingsBody")}
          </TabsContent>
        </Tabs>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          defaultValue="30d"
          aria-label={t("tabs.period")}
        >
          {(["7d", "30d", "year"] as const).map((value) => (
            <ToggleGroupItem key={value} value={value}>
              {t(`tabs.periods.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Group>

      <Group
        id="badges"
        title={t("groups.badges")}
        hint={t("hints.badges")}
        code="@/components/ui/badge"
      >
        <div className="flex flex-wrap gap-2">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {t(`variants.${variant}`)}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" data-testid="components-status">
          {STATUS_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {t(`variants.${variant}`)}
            </Badge>
          ))}
        </div>
      </Group>

      <Group
        id="cards"
        title={t("groups.cards")}
        hint={t("hints.cards")}
        code="@/components/ui/card"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {CARD_VARIANTS.map((variant) => (
            <Card
              key={variant}
              variant={variant}
              className={variant === "framed" ? undefined : "px-5"}
            >
              {variant === "framed" ? (
                <>
                  <p className="text-12 text-text-secondary px-3 py-2">
                    {t(`card.variants.${variant}`)}
                  </p>
                  <div className="bg-card border-border rounded-inner text-14 border p-4">
                    {t(`card.hints.${variant}`)}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-14 text-text font-medium">
                    {t(`card.variants.${variant}`)}
                  </p>
                  <p className="text-12 text-text-secondary">
                    {t(`card.hints.${variant}`)}
                  </p>
                </>
              )}
            </Card>
          ))}
        </div>
        <Card variant="surface" className="max-w-sm">
          <CardHeader>
            <CardTitle>{t("card.title")}</CardTitle>
            <CardDescription>{t("card.description")}</CardDescription>
          </CardHeader>
          <CardContent className="text-14">{t("card.body")}</CardContent>
          <CardFooter>
            <Button size="sm">{t("card.action")}</Button>
          </CardFooter>
        </Card>
      </Group>

      <Group
        id="table"
        title={t("groups.table")}
        hint={t("hints.table")}
        code="@/components/ui/table"
      >
        <Table variant="soft">
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.name")}</TableHead>
              <TableHead>{t("table.plan")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SAMPLE_ROWS.map((row) => (
              <TableRow key={row.name}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.plan}</TableCell>
                <TableCell>
                  <Badge
                    variant={row.status === "active" ? "default" : "outline"}
                  >
                    {t(`table.statuses.${row.status}`)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Group>

      <Group
        id="accordion"
        title={t("groups.accordion")}
        hint={t("hints.accordion")}
        code="@/components/ui/accordion"
      >
        <Accordion type="single" collapsible variant="cards" defaultValue="why">
          {(["welcome", "why"] as const).map((id) => (
            <AccordionItem key={id} value={id}>
              <AccordionTrigger>
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <AlignJustify
                    aria-hidden
                    className="text-text-secondary size-4 shrink-0"
                  />
                  <span className="min-w-0 truncate">
                    {t(`accordion.${id}`)}
                  </span>
                  <Badge variant={id === "why" ? "success" : "neutral"}>
                    {t(id === "why" ? "variants.success" : "variants.neutral")}
                  </Badge>
                </span>
              </AccordionTrigger>
              <AccordionContent>{t("accordion.body")}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Group>

      <Group
        id="items"
        title={t("groups.items")}
        hint={t("hints.items")}
        code="@/components/ui/item · @/components/patterns/field-card"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Item variant="card" size="sm">
            <ItemMedia>
              <FileText className="text-text-secondary size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>catalogo-loja-centro.pdf</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("items.details")}
              >
                <Info />
              </Button>
            </ItemActions>
          </Item>
          <FieldCard
            label={t("items.fieldLabel")}
            value="gd_live_4f9c2a7e81b3"
            action={
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t("items.copy")}
              >
                <Copy />
              </Button>
            }
          />
        </div>
      </Group>

      <Group
        id="input-group"
        title={t("groups.inputGroup")}
        hint={t("hints.inputGroup")}
        code="@/components/ui/input-group"
      >
        <InputGroup className="rounded-card">
          <InputGroupTextarea
            aria-label={t("inputGroup.label")}
            placeholder={t("inputGroup.placeholder")}
          />
          <InputGroupAddon align="block-end" className="flex-wrap gap-2">
            <InputGroupButton variant="outline" size="sm">
              <Sparkles />
              {t("inputGroup.askAi")}
            </InputGroupButton>
            <InputGroupButton variant="default" size="sm" className="ml-auto">
              {t("inputGroup.send")}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Group>

      <Group
        id="empty"
        title={t("groups.empty")}
        hint={t("hints.empty")}
        code="@/components/ui/empty"
      >
        <Empty className="bg-surface-inset rounded-inner">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>{t("empty.title")}</EmptyTitle>
            <EmptyDescription>{t("empty.description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Group>

      <Group
        id="alerts"
        title={t("groups.alerts")}
        hint={t("hints.alerts")}
        code="@/components/ui/alert"
      >
        <Alert>
          <Info />
          <AlertTitle>{t("alert.title")}</AlertTitle>
          <AlertDescription>{t("alert.body")}</AlertDescription>
        </Alert>
      </Group>

      <SectionHeader
        title={t("sections.patterns")}
        description={t("sections.patternsHint")}
      />

      <Group
        id="stats"
        title={t("groups.stats")}
        hint={t("hints.stats")}
        code="@/components/patterns/stat-card · stat-group · amount"
      >
        <div
          className="grid gap-4 md:grid-cols-3"
          data-testid="components-stat-cards"
        >
          <StatCard
            variant="flush"
            icon={<TrendingUp className="size-4" />}
            label={t("stats.growth")}
            value={<span className="text-success-text">+10,72%</span>}
            caption={t("stats.growthCaption")}
          />
          <StatCard
            icon={<Wallet className="size-4" />}
            label={t("stats.sales")}
            value={<Amount value={13066.6} locale={locale} currency="BRL" />}
            caption={t("stats.salesCaption")}
          />
          <StatCard
            variant="plain"
            label={t("stats.answered")}
            value="94%"
            caption={t("stats.answeredCaption")}
          />
        </div>
        <StatGroup
          items={[
            {
              label: t("stats.sent"),
              value: "132",
              icon: <Send className="size-4" />,
            },
            {
              label: t("stats.read"),
              value: "110",
              icon: <Eye className="size-4" />,
            },
          ]}
        />
      </Group>

      <Group
        id="key-value"
        title={t("groups.keyValue")}
        hint={t("hints.keyValue")}
        code="@/components/patterns/key-value-list"
      >
        <KeyValueList
          className="max-w-md"
          items={[
            { label: t("keyValue.responseTime"), value: "38 s" },
            {
              label: t("keyValue.aiCost"),
              value: <Amount value={84.2} locale={locale} currency="BRL" />,
            },
          ]}
        />
      </Group>

      <Group
        id="tags"
        title={t("groups.tags")}
        hint={t("hints.tags")}
        code="@/components/patterns/tag-list"
      >
        <TagList
          tags={tags}
          max={3}
          onRemove={(tag) => setTags((list) => list.filter((x) => x !== tag))}
          removeLabel={(tag) => t("tags.remove", { tag })}
          moreLabel={(count) => t("tags.more", { count })}
        />
      </Group>

      <Group
        id="headers"
        title={t("groups.headers")}
        hint={t("hints.headers")}
        code="@/components/patterns/page-canvas · page-title · section-header"
      >
        <SectionHeader
          level={3}
          title={t("headers.title")}
          description={t("headers.description")}
          actions={
            <Button variant="outline" size="sm">
              {t("headers.action")}
            </Button>
          }
        />
      </Group>
    </PageCanvas>
  );
}

function Group({
  id,
  title,
  hint,
  code,
  children,
}: Readonly<{
  id: string;
  title: string;
  hint: string;
  code?: string;
  children: ReactNode;
}>) {
  return (
    <Card variant="surface" className="px-6">
      <section className="flex flex-col gap-4" data-testid={`components-${id}`}>
        <div className="flex flex-col gap-1">
          <h3 className="text-16 text-text font-semibold">{title}</h3>
          <p className="text-12 text-text-secondary">{hint}</p>
          {code ? (
            <code className="text-11 text-text-tertiary font-mono">{code}</code>
          ) : null}
        </div>
        {children}
      </section>
    </Card>
  );
}
