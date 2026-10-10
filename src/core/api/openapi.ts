import { z } from "zod";

import { API_ROUTES, type ApiRoute, ErrorBody } from "./contracts";

/**
 * OpenAPI 3.1 document of the REST API v1 (F4a), built from the same Zod
 * schemas the routes validate with; it cannot drift from the code.
 */

const schema = (s: z.ZodType) =>
  z.toJSONSchema(s, { io: "output", unrepresentable: "any" });

const ERRORS: Record<string, string> = {
  "401": "Sem sessão, ou chave de API inválida, expirada ou revogada.",
  "403": "Sem permissão ou sem o escopo exigido pela chave.",
  "404": "Workspace inexistente ou fora do seu alcance.",
  "422": "Parâmetros inválidos.",
  "429": "Limite de requisições atingido; veja Retry-After.",
};

function operation(route: ApiRoute) {
  const parameters: unknown[] = [];
  if (route.workspaceScoped) {
    parameters.push({
      name: "id",
      in: "path",
      required: true,
      description: "Id (UUID) do workspace.",
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
    "200": {
      description: "Sucesso.",
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
        "API REST v1 (Especificação §15). Autenticação por chave de API (Authorization: Bearer gdu_live_…) com escopos, ou pela sessão do navegador. Erros trazem code, message e requestId. Limites por chave, usuário e workspace, com cabeçalhos RateLimit-*.",
    },
    servers: [{ url: `${serverUrl.replace(/\/$/, "")}/api/v1` }],
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "Chave criada em Configurações › MCP, com escopos.",
        },
        session: {
          type: "apiKey",
          in: "cookie",
          name: "sb-<projeto>-auth-token",
          description: "Sessão do navegador no mesmo host (uso das telas).",
        },
      },
      schemas: { Error: schema(ErrorBody) },
    },
    paths,
  };
}
