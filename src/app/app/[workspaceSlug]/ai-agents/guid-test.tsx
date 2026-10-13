"use client";

import { Bot, ChevronDown, Send, User, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { WorkbenchPanel } from "@/components/layout/workbench";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  type GuidTestActionState,
  loadGuidTestAction,
  sendGuidTestAction,
} from "@/modules/ai-agents/server/actions";
import type {
  GuidTestConversationDto,
  GuidTestMessageDto,
} from "@/modules/ai-agents/server/services/conversations";

/**
 * "Testar agente" (A4b, especificação §5.3): a chat in the drawer with the
 * real prompt, key and model; the tools only show what they would do. The
 * worker answers; the screen reads the conversation again until the answer
 * arrives, then refreshes the page so the GUIDS shows the test.
 */

const POLL_MS = 1500;
/** After this, the screen stops waiting; the answer still lands later. */
const WAIT_MS = 120_000;
const ERROR_CODES = new Set([
  "module_unavailable",
  "conversation_handoff",
  "conversation_closed",
  "agent_paused",
  "key_failed",
  "plan_limit",
  "invalid_config",
  "no_model",
  "no_key",
  "no_prompt",
  "engine_error",
  "invalid_output",
  "provider_auth",
  "provider_error",
  "provider_limit",
  "timeout",
]);

export function GuidTestPanel({
  workspaceSlug,
  agentId,
  title,
  backHref,
  initial,
}: Readonly<{
  workspaceSlug: string;
  agentId: string;
  title: string;
  backHref: string;
  initial: GuidTestConversationDto | null;
}>) {
  const t = useTranslations("aiAgents.guids.test");
  const router = useRouter();
  const [conversation, setConversation] = useState(initial);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<GuidTestActionState>({});
  const [sending, startSending] = useTransition();
  const [slow, setSlow] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useActionStatus(state);

  const conversationId = conversation?.conversationId ?? null;
  const waiting = conversation?.waiting ?? false;

  const reload = useCallback(
    async (id: string) => {
      const result = await loadGuidTestAction(workspaceSlug, agentId, id);
      if ("error" in result) {
        setState({ error: result.error });
        return null;
      }
      setConversation(result.conversation);
      return result.conversation;
    },
    [workspaceSlug, agentId],
  );

  // While the agent answers, read the conversation again.
  useEffect(() => {
    if (!waiting || !conversationId) return;
    const started = Date.now();
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (Date.now() - started > WAIT_MS) {
        window.clearInterval(timer);
        setSlow(true);
        return;
      }
      const next = await reload(conversationId);
      if (!stopped && next && !next.waiting) {
        window.clearInterval(timer);
        // The GUIDS may now show the test of this configuration.
        router.refresh();
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [waiting, conversationId, reload, router]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [conversation?.messages.length]);

  function send() {
    const text = draft.trim();
    if (!text || sending || waiting) return;
    startSending(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("agentId", agentId);
      formData.append("text", text);
      if (conversationId) formData.append("conversationId", conversationId);
      const result = await sendGuidTestAction({}, formData);
      // Success needs no banner: the message shows in the chat.
      if (!result.success || !result.conversationId) {
        setState(result);
        return;
      }
      setDraft("");
      setSlow(false);
      await reload(result.conversationId);
    });
  }

  return (
    <WorkbenchPanel
      title={title}
      description={t("intro")}
      footer={
        <form
          className="flex w-full items-end gap-2"
          data-testid="guid-test-form"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <Textarea
            aria-label={t("placeholder")}
            placeholder={t("placeholder")}
            value={draft}
            rows={2}
            maxLength={4000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            data-testid="guid-test-input"
          />
          <Button
            type="submit"
            size="icon"
            aria-label={t("send")}
            disabled={sending || waiting || !draft.trim()}
            data-testid="guid-test-send"
          >
            <Send />
          </Button>
        </form>
      }
    >
      <div className="space-y-4" data-testid="guid-test">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={backHref} scroll={false}>
              {t("back")}
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!conversation || sending || waiting}
            onClick={() => {
              setConversation(null);
              setSlow(false);
            }}
            data-testid="guid-test-new"
          >
            {t("newConversation")}
          </Button>
        </div>
        {conversation && conversation.messages.length > 0 ? (
          <ol className="space-y-3" aria-live="polite">
            {conversation.messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
          </ol>
        ) : (
          <p className="text-12 text-text-secondary">{t("empty")}</p>
        )}
        {waiting ? (
          <p
            className="text-12 text-text-secondary"
            data-testid="guid-test-waiting"
          >
            {slow ? t("slow") : t("waiting")}
          </p>
        ) : null}
        <div ref={end} />
      </div>
    </WorkbenchPanel>
  );
}

function ChatMessage({ message }: Readonly<{ message: GuidTestMessageDto }>) {
  const t = useTranslations("aiAgents.guids.test");
  const user = message.role === "user";
  const text = message.errorCode
    ? t("failed", {
        reason: t(
          `errors.${ERROR_CODES.has(message.errorCode) ? message.errorCode : "unknown"}`,
        ),
      })
    : message.content;
  return (
    <li
      className={cn("flex gap-2", user && "flex-row-reverse")}
      data-testid={user ? "guid-test-user" : "guid-test-agent"}
    >
      <span
        className="bg-surface-strong text-text-subtle flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        aria-label={user ? t("you") : t("agent")}
      >
        {user ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </span>
      <div className="max-w-md min-w-0 space-y-2">
        {message.tools.length > 0 ? <ToolCalls message={message} /> : null}
        <p
          className={cn(
            "text-14 rounded-xl px-3 py-2 whitespace-pre-wrap",
            user
              ? "bg-primary text-on-primary"
              : message.errorCode
                ? "bg-surface-hover text-destructive"
                : "bg-surface-hover text-text",
          )}
        >
          {text}
        </p>
      </div>
    </li>
  );
}

function ToolCalls({ message }: Readonly<{ message: GuidTestMessageDto }>) {
  const t = useTranslations("aiAgents.guids.test");
  return (
    <Collapsible className="border-card-border rounded-xl border">
      <CollapsibleTrigger
        className="text-12 text-text-secondary flex w-full items-center gap-2 px-3 py-2"
        data-testid="guid-test-tools"
      >
        <Wrench className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">
          {t("tools", { count: message.tools.length })}
        </span>
        <ChevronDown className="h-3.5 w-3.5" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="divide-border divide-y">
          {message.tools.map((call, index) => (
            <li key={index} className="space-y-1 px-3 py-2">
              <p className="text-12 text-text font-medium">{call.name}</p>
              <pre className="text-11 text-text-secondary overflow-x-auto whitespace-pre-wrap">
                {t("input")}: {JSON.stringify(call.input)}
              </pre>
              <pre className="text-11 text-text-secondary overflow-x-auto whitespace-pre-wrap">
                {t("output")}:{" "}
                {call.output === null
                  ? t("refused")
                  : JSON.stringify(call.output)}
              </pre>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
