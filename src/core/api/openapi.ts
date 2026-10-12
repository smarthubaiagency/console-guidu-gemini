import { z } from "zod";

import { API_ROUTES, type ApiRoute, ErrorBody } from "./contracts";

/**
 * OpenAPI 3.1 document of the REST API v1 (F4a), built from the same Zod
 * schemas the routes validate with; it cannot drift from the code.
 */

const schema = (s: z.ZodType, io: "input" | "output" = "output") =>
  z.toJSONSchema(s, { io, unrepresentable: "any" });

const ERRORS: Record<string, string> = {
  "401": "No session, or the API key is invalid, expired or revoked.",
  "403": "No permission, or the key lacks the required scope.",
  "404": "Workspace or record does not exist or is out of your reach.",
  "422": "Invalid parameters or body.",
  "429": "Rate limit reached; see Retry-After.",
};

const PATH_PARAMS: Record<string, string> = {
  contactId: "of the contact",
  itemId: "of the item",
  variantId: "of the variant",
};

function operation(route: ApiRoute) {
  const parameters: unknown[] = [];
  if (route.workspaceScoped) {
    parameters.push({
      name: "id",
      in: "path",
      required: true,
      description: "Id (UUID) of the workspace.",
      schema: { type: "string", format: "uuid" },
    });
  }
  for (const [, name] of route.path.matchAll(/\{(\w+)\}/g)) {
    if (name === "id" || !name) continue;
    parameters.push({
      name,
      in: "path",
      required: true,
      description: `Id (UUID) ${PATH_PARAMS[name] ?? "of the record"}.`,
      schema: { type: "string", format: "uuid" },
    });
  }
  if (route.query) {
    for (const [name, field] of Object.entries(route.query.shape)) {
      parameters.push({
        name,
        in: "query",
        required: false,
        schema: schema(field as z.ZodType),
      });
    }
  }
  const responses: Record<string, unknown> = {
    [String(route.successStatus ?? 200)]: {
      description: "Success.",
      content: { "application/json": { schema: schema(route.response) } },
    },
  };
  for (const [status, description] of Object.entries(ERRORS)) {
    responses[status] = {
      description,
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/Error" } },
      },
    };
  }
  return {
    ...(route.body
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: schema(route.body, "input") },
            },
          },
        }
      : {}),
    operationId: route.operationId,
    summary: route.summary,
    "x-required-scope": route.scope,
    security: [{ apiKey: [route.scope] }, { session: [] }],
    parameters,
    responses,
  };
}

export function buildOpenApiDocument(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of Object.values(API_ROUTES) as ApiRoute[]) {
    paths[route.path] = {
      ...(paths[route.path] ?? {}),
      [route.method.toLowerCase()]: operation(route),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "GUIDU API",
      version: "1.0.0",
      description:
        "REST API v1. Authentication with an API key (Authorization: Bearer gdu_live_…) with scopes, or with the browser session. Errors carry code, message (always in English) and requestId. Rate limits per key, user and workspace, with RateLimit-* headers.",
    },
    servers: [{ url: `${serverUrl.replace(/\/$/, "")}/api/v1` }],
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "Key created in Settings › MCP, with scopes.",
        },
        session: {
          type: "apiKey",
          in: "cookie",
          name: "sb-<project>-auth-token",
          description:
            "Browser session on the same host (used by the dashboard).",
        },
      },
      schemas: { Error: schema(ErrorBody) },
    },
    paths,
  };
}
