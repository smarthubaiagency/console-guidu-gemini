import "server-only";

import { recordAudit } from "@/core/audit/record";
import { GOOGLE_BUSINESS_SPECIALIST } from "@/core/ai/specialist/definitions";
import {
  askSpecialist,
  type SpecialistAnswer,
  type SpecialistDeps,
  specialistKey,
  SpecialistQuestion,
} from "@/core/ai/specialist/turn";
import type { RequestContext } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { AREA_SKILLS, type AutomationArea } from "../areas";
import { type AutomationView, loadAutomation } from "./automation";
import type { Db } from "./runner";

/**
 * "Preciso saber mais" (GB1a): the GMN specialist answers questions about
 * the automation page in the drawer, with the ficha, the findings and the
 * areas as context. It only answers: no tool, nothing changes. Our key
 * (ADR 0019 item 5, decision of 16/10/2026).
 */

/** The page as plain text for the model (no personal data of reviewers). */
export function specialistContext(
  view: AutomationView,
  area: AutomationArea | null,
): string {
  const lines = [
    `Ficha: ${view.location.name}`,
    `Unit: ${view.location.unitName ?? "-"} (${view.location.address ?? "no address"})`,
    `Service mode: ${view.mode}`,
    `Reviewed by a person: ${view.location.reviewed ? "yes" : "no (the agent only suggests until then)"}`,
    `Diagnosis: ${view.diagnosis.ok} of ${view.diagnosis.total} items in order`,
    `Autonomy ceiling: ${view.ceiling}`,
    area ? `The person is looking at the area: ${area}` : "",
    "Areas (area: on/off, autonomy, approved, skills):",
    ...view.areas.map(
      (a) =>
        `- ${a.area}: ${a.enabled ? "on" : "off"}, ${a.autonomy}, ${a.approved ? "approved" : "not approved"}, skills ${AREA_SKILLS[a.area].join(", ")}`,
    ),
    "Analyses (key, area, status, metrics):",
    ...view.runs.map(
      (r) => `- ${r.key} (${r.area}): ${r.status} ${JSON.stringify(r.metrics)}`,
    ),
    "Findings (key, area, severity, values):",
    ...view.runs.flatMap((r) =>
      r.findings.map(
        (f) =>
          `- ${f.key} (${f.area}, ${f.severity}) ${f.values ? JSON.stringify(f.values) : ""}`,
      ),
    ),
  ];
  return lines.filter(Boolean).join("\n");
}

export async function askLocationSpecialist(
  db: Db,
  ctx: RequestContext,
  locationId: string,
  input: unknown,
  options: Readonly<{
    area: AutomationArea | null;
    locale: string;
    origin: "app" | "admin";
  }>,
  deps: SpecialistDeps = {},
): Promise<SpecialistAnswer> {
  const parsed = SpecialistQuestion.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Escreva sua pergunta.",
      messageKey: "googleBusiness.errors.questionInvalid",
    });
  }
  const view = await db((tx) => loadAutomation(tx, ctx, locationId));
  const answer = await askSpecialist(
    GOOGLE_BUSINESS_SPECIALIST,
    {
      question: parsed.data.question,
      history: parsed.data.history,
      context: specialistContext(view, options.area),
      locale: options.locale,
    },
    () => db((tx) => specialistKey(tx)),
    deps,
  );
  await db((tx) =>
    recordAudit(tx, ctx, {
      action: "google_business.specialist.ask",
      resourceType: "gb_location",
      resourceId: locationId,
      result: "success",
      origin: options.origin,
      metadata: {
        agentId: GOOGLE_BUSINESS_SPECIALIST.key,
        model: answer.model,
        count: answer.usage.inputTokens + answer.usage.outputTokens,
      },
    }),
  );
  return answer;
}
