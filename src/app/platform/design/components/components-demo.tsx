"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ModulePageHeader } from "@/components/modules/module-page-header";
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
import { Input } from "@/components/ui/input";
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

const SAMPLE_ROWS = [
  { name: "Maria Souza", plan: "Pro", status: "active" },
  { name: "João Lima", plan: "Start", status: "trial" },
  { name: "Ana Reis", plan: "Pro", status: "paused" },
] as const;

/** Catalogue of the shadcn components (ADR 0014) for visual approval. */
export function ComponentsDemo() {
  const t = useTranslations("designLab.components");

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <ModulePageHeader title={t("title")} description={t("subtitle")} />
      <div
        role="note"
        className="border-info-border bg-info-bg text-info-text text-12 flex items-center gap-2 rounded-lg border px-3 py-2"
      >
        <Info className="h-4 w-4 shrink-0" />
        {t("sampleNotice")}
      </div>

      <Group id="buttons" title={t("groups.buttons")} hint={t("hints.buttons")}>
        <div className="flex flex-wrap gap-2">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {t(`variants.${variant}`)}
            </Button>
          ))}
          <Button disabled>{t("variants.disabled")}</Button>
        </div>
      </Group>

      <Group id="fields" title={t("groups.fields")} hint={t("hints.fields")}>
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

      <Group id="selects" title={t("groups.selects")} hint={t("hints.selects")}>
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

      <Group id="choices" title={t("groups.choices")} hint={t("hints.choices")}>
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

      <Group id="tabs" title={t("groups.tabs")} hint={t("hints.tabs")}>
        <Tabs defaultValue="overview">
          <TabsList>
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
      </Group>

      <Group id="badges" title={t("groups.badges")} hint={t("hints.badges")}>
        <div className="flex flex-wrap gap-2">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {t(`variants.${variant}`)}
            </Badge>
          ))}
        </div>
      </Group>

      <Group id="cards" title={t("groups.cards")} hint={t("hints.cards")}>
        <Card className="max-w-sm">
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

      <Group id="table" title={t("groups.table")} hint={t("hints.table")}>
        <Table>
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

      <Group id="alerts" title={t("groups.alerts")} hint={t("hints.alerts")}>
        <Alert>
          <Info />
          <AlertTitle>{t("alert.title")}</AlertTitle>
          <AlertDescription>{t("alert.body")}</AlertDescription>
        </Alert>
      </Group>
    </div>
  );
}

function Group({
  id,
  title,
  hint,
  children,
}: Readonly<{ id: string; title: string; hint: string; children: ReactNode }>) {
  return (
    <section className="space-y-3" data-testid={`components-${id}`}>
      <div>
        <h2 className="text-14 text-text font-semibold">{title}</h2>
        <p className="text-12 text-text-secondary">{hint}</p>
      </div>
      {children}
    </section>
  );
}
