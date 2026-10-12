"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, Info, Pencil, Send, User } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useWorkbench,
  WorkbenchLayout,
  WorkbenchPanel,
} from "@/components/layout/workbench";
import { cn } from "@/lib/utils";

export type DemoKey = "edit" | "chat" | "simple";
const DEMOS: readonly DemoKey[] = ["edit", "chat", "simple"];

/** Sample rows of the page: shown as examples, never stored. */
const SAMPLES = [
  { id: "1", name: "Ana Souza", email: "ana@exemplo.test", city: "São Paulo" },
  { id: "2", name: "Bruno Lima", email: "bruno@exemplo.test", city: "Recife" },
  {
    id: "3",
    name: "Carla Dias",
    email: "carla@exemplo.test",
    city: "Curitiba",
  },
  { id: "4", name: "Diego Alves", email: "diego@exemplo.test", city: "Belém" },
  { id: "5", name: "Elisa Rocha", email: "elisa@exemplo.test", city: "Natal" },
  { id: "6", name: "Fábio Melo", email: "fabio@exemplo.test", city: "Goiânia" },
] as const;
type Sample = (typeof SAMPLES)[number];

function DemoHeader({ demo }: Readonly<{ demo: DemoKey }>) {
  const t = useTranslations("designLab");
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-20 text-text font-bold">{t("title")}</h1>
        <p className="text-12 text-text-secondary">{t("subtitle")}</p>
      </div>
      <div
        role="note"
        className="border-info-border bg-info-bg text-info-text text-12 flex items-center gap-2 rounded-lg border px-3 py-2"
      >
        <Info className="h-4 w-4 shrink-0" />
        {t("sampleNotice")}
      </div>
      <nav aria-label={t("demos")} className="flex flex-wrap gap-2">
        {DEMOS.map((key) => (
          <Link
            key={key}
            href={`/platform/design/workbench?demo=${key}`}
            aria-current={key === demo ? "page" : undefined}
            className={cn(
              "text-12 border-border rounded-lg border px-3 py-1.5 font-medium transition",
              key === demo
                ? "bg-surface-strong text-text"
                : "text-text-subtle hover:bg-surface-hover",
            )}
          >
            {t(`demo.${key}`)}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function SampleList({
  selected,
  onSelect,
}: Readonly<{ selected: string | null; onSelect: (row: Sample) => void }>) {
  return (
    <ul className="space-y-1 p-3">
      {SAMPLES.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => onSelect(row)}
            aria-current={row.id === selected ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition",
              row.id === selected
                ? "bg-surface-strong"
                : "hover:bg-surface-hover",
            )}
          >
            <span className="bg-primary-subtle text-primary-text text-12 flex h-8 w-8 items-center justify-center rounded-full font-semibold">
              {row.name.charAt(0)}
            </span>
            <span className="min-w-0">
              <span className="text-14 text-text block truncate font-medium">
                {row.name}
              </span>
              <span className="text-12 text-text-secondary block truncate">
                {row.city}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SampleTable({ onEdit }: Readonly<{ onEdit: (row: Sample) => void }>) {
  const t = useTranslations("designLab");
  return (
    <div className="px-4 pb-6 md:px-6">
      <div className="border-card-border bg-surface-card overflow-x-auto rounded-xl border">
        <table className="text-12 w-full">
          <thead className="bg-surface-sidebar text-text-secondary text-left">
            <tr>
              <th className="px-4 py-2 font-semibold">{t("field.name")}</th>
              <th className="px-4 py-2 font-semibold">{t("field.email")}</th>
              <th className="px-4 py-2 font-semibold">{t("field.city")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {SAMPLES.map((row) => (
              <tr key={row.id} className="border-border border-t">
                <td className="text-text px-4 py-3 font-medium">{row.name}</td>
                <td className="text-text-subtle px-4 py-3">{row.email}</td>
                <td className="text-text-subtle px-4 py-3">{row.city}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(row)}
                  >
                    <Pencil />
                    {t("edit")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditForm({ row }: Readonly<{ row: Sample }>) {
  const t = useTranslations("designLab");
  return (
    <form
      id="sample-edit"
      className="space-y-4"
      onSubmit={(event) => event.preventDefault()}
    >
      {(["name", "email", "city"] as const).map((field) => (
        <div key={field} className="space-y-1.5">
          <label
            htmlFor={`sample-${field}`}
            className="text-12 text-text-subtle font-medium"
          >
            {t(`field.${field}`)}
          </label>
          <Input
            id={`sample-${field}`}
            key={`${row.id}-${field}`}
            defaultValue={row[field]}
          />
        </div>
      ))}
      <div className="space-y-1.5">
        <label
          htmlFor="sample-notes"
          className="text-12 text-text-subtle font-medium"
        >
          {t("field.notes")}
        </label>
        <textarea
          id="sample-notes"
          rows={5}
          className="border-input text-14 text-text w-full rounded-md border bg-transparent px-3 py-2"
        />
      </div>
    </form>
  );
}

function EditDemo() {
  const t = useTranslations("designLab");
  const [row, setRow] = useState<Sample>(SAMPLES[0]);
  const [open, setOpen] = useState(false);
  const edit = (next: Sample) => {
    setRow(next);
    setOpen(true);
  };

  return (
    <WorkbenchLayout
      left={<SampleList selected={open ? row.id : null} onSelect={edit} />}
      leftLabel={t("list")}
      main={
        <>
          <DemoHeader demo="edit" />
          <SampleTable onEdit={edit} />
        </>
      }
      panelLabel={t("editTitle")}
      panelOpen={open}
      onPanelOpenChange={setOpen}
      panel={
        <WorkbenchPanel
          title={t("editTitle")}
          description={row.name}
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" form="sample-edit">
                {t("save")}
              </Button>
            </>
          }
        >
          <EditForm row={row} />
        </WorkbenchPanel>
      }
    />
  );
}

function ChatPanel() {
  const t = useTranslations("designLab");
  const [messages, setMessages] = useState<
    { from: "user" | "assistant"; text: string }[]
  >([{ from: "assistant", text: t("chatHello") }]);
  const [draft, setDraft] = useState("");

  return (
    <WorkbenchPanel
      title={t("chatTitle")}
      description={t("chatSubtitle")}
      footer={
        <form
          className="flex w-full gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            setMessages((list) => [
              ...list,
              { from: "user", text: draft.trim() },
              { from: "assistant", text: t("chatEcho") },
            ]);
            setDraft("");
          }}
        >
          <Input
            aria-label={t("chatInput")}
            placeholder={t("chatInput")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="icon" aria-label={t("chatSend")}>
            <Send />
          </Button>
        </form>
      }
    >
      <ol className="space-y-3" aria-live="polite">
        {messages.map((message, index) => (
          <li
            key={index}
            className={cn(
              "flex gap-2",
              message.from === "user" && "flex-row-reverse",
            )}
          >
            <span className="bg-surface-strong text-text-subtle flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
              {message.from === "user" ? (
                <User className="h-4 w-4" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
            </span>
            <p
              className={cn(
                "text-14 max-w-md min-w-0 rounded-xl px-3 py-2",
                message.from === "user"
                  ? "bg-primary text-on-primary"
                  : "bg-surface-hover text-text",
              )}
            >
              {message.text}
            </p>
          </li>
        ))}
      </ol>
    </WorkbenchPanel>
  );
}

function OpenButton({ label }: Readonly<{ label: string }>) {
  const { setPanelOpen } = useWorkbench();
  return (
    <Button onClick={() => setPanelOpen(true)} data-testid="workbench-open">
      {label}
    </Button>
  );
}

function ChatDemo() {
  const t = useTranslations("designLab");
  return (
    <WorkbenchLayout
      left={<SampleList selected={null} onSelect={() => undefined} />}
      leftLabel={t("list")}
      defaultPanelOpen
      panelLabel={t("chatTitle")}
      main={
        <>
          <DemoHeader demo="chat" />
          <div className="space-y-4 px-4 pb-6 md:px-6">
            <p className="text-14 text-text-subtle max-w-2xl">
              {t("chatHint")}
            </p>
            <OpenButton label={t("openChat")} />
            <SampleTable onEdit={() => undefined} />
          </div>
        </>
      }
      panel={<ChatPanel />}
    />
  );
}

function SimpleDemo() {
  const t = useTranslations("designLab");
  return (
    <WorkbenchLayout
      panelLabel={t("simpleTitle")}
      main={
        <>
          <DemoHeader demo="simple" />
          <div className="space-y-4 px-4 pb-6 md:px-6">
            <p className="text-14 text-text-subtle max-w-2xl">
              {t("simpleHint")}
            </p>
            <OpenButton label={t("openPanel")} />
          </div>
        </>
      }
      panel={
        <WorkbenchPanel title={t("simpleTitle")}>
          <p className="text-14 text-text-subtle">{t("simpleBody")}</p>
        </WorkbenchPanel>
      }
    />
  );
}

/** Showcase of the workbench (ADR 0015) for visual approval. */
export function WorkbenchDemo({ demo }: Readonly<{ demo: DemoKey }>) {
  if (demo === "chat") return <ChatDemo />;
  if (demo === "simple") return <SimpleDemo />;
  return <EditDemo />;
}
