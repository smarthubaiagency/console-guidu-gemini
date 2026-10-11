import { randomBytes, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { API_ROUTES } from "@/core/api/contracts";
import { type ApiCall, type ApiDeps, handleApiRoute } from "@/core/api/handler";
import * as portfolioApi from "@/core/api/portfolio";
import {
  API_KEY_PREFIX,
  createApiKey,
  hashApiKey,
} from "@/core/credentials/api-keys";
import { handleMcpWorkspaceRequest } from "@/core/mcp/server";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  approveProposal,
  createProposal,
  executeProposal,
} from "@/core/proposals/service";
import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import {
  agentGetItem,
  agentSearch,
  createItem,
  getCatalogProduct,
  type ItemView,
  lookupCatalog,
  searchCatalog,
} from "@/modules/portfolio/server";
import { AppError } from "@/shared/errors";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";
import { ucpErrors } from "../unit/support/ucp";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const owner: RequestContext = { ...contextA, principalType: "user" };
const viewer: RequestContext = { ...owner, userId: ids.userMultiOrg };
const brl = (amount: number) => ({ amount, currency: "BRL" });

type Json = Record<string, unknown>;

describeDatabase(
  "F5d: Portfolio catalog in UCP, agent view, API, MCP",
  requiredVars,
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });
    const deps: ApiDeps = {
      prisma,
      redis: null,
      session: async () => {
        throw new Error("no session");
      },
    };
    const run = <T>(
      ctx: RequestContext,
      fn: Parameters<typeof withContext<T>>[2],
    ) => withContext(prisma, ctx, fn);

    let shirt: ItemView;
    let consult: ItemView;
    let hidden: ItemView;

    async function cleanup() {
      for (const sql of [
        `delete from public.execution_proposals where workspace_id = '${ids.workspaceA}'`,
        `delete from public.job_runs where kind = 'core.proposal-execute' and workspace_id = '${ids.workspaceA}'`,
        `delete from public.portfolio_variants where workspace_id = '${ids.workspaceA}'`,
        `delete from public.portfolio_items where workspace_id = '${ids.workspaceA}'`,
        `delete from public.workspace_modules where module_key = 'portfolio'`,
        `delete from public.api_keys where workspace_id = '${ids.workspaceA}' and name = 'F5d'`,
      ]) {
        await admin.$executeRawUnsafe(sql);
      }
    }

    async function createKey(scopes: string[], user: string = ids.userA) {
      const raw = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
      const id = randomUUID();
      await admin.$executeRawUnsafe(
        `insert into public.api_keys
         (id, organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
       values ('${id}', '${ids.organizationA}', '${ids.workspaceA}', '${user}', 'F5d',
               '${raw.slice(0, 16)}', '${hashApiKey(raw)}', $1::text[], now() + interval '1 day')`,
        scopes,
      );
      return { raw, id };
    }

    type Route = keyof typeof API_ROUTES;
    const RUN: Partial<
      Record<Route, (p: PrismaClient, c: ApiCall) => Promise<unknown>>
    > = {
      searchPortfolioCatalog: portfolioApi.searchPortfolioCatalog,
      lookupPortfolioCatalog: portfolioApi.lookupPortfolioCatalog,
      getPortfolioCatalogProduct: portfolioApi.getPortfolioCatalogProduct,
      searchPortfolioForAgent: portfolioApi.searchPortfolioForAgent,
      getPortfolioItemForAgent: portfolioApi.getPortfolioItemForAgent,
      createPortfolioItem: portfolioApi.createPortfolioItem,
      updatePortfolioItem: portfolioApi.updatePortfolioItem,
      updatePortfolioVariant: portfolioApi.updatePortfolioVariant,
    };

    async function rest(
      route: Route,
      options: Readonly<{
        key: string;
        body?: unknown;
        params?: Record<string, string>;
        query?: string;
      }>,
    ) {
      const def = API_ROUTES[route];
      const headers = new Headers({
        host: "localhost:3000",
        authorization: `Bearer ${options.key}`,
      });
      if (options.body !== undefined)
        headers.set("content-type", "application/json");
      let path = def.path.replace("{id}", ids.workspaceA);
      for (const [k, v] of Object.entries(options.params ?? {})) {
        path = path.replace(`{${k}}`, v);
      }
      const request = new Request(
        `http://localhost:3000/api/v1${path}${options.query ?? ""}`,
        {
          method: def.method,
          headers,
          ...(options.body !== undefined
            ? { body: JSON.stringify(options.body) }
            : {}),
        },
      );
      const response = await handleApiRoute(
        request,
        def,
        { id: ids.workspaceA, ...options.params },
        deps,
        (call) => RUN[route]!(prisma, call),
      );
      return { status: response.status, body: (await response.json()) as Json };
    }

    async function mcp(
      key: string,
      method: string,
      params: Record<string, unknown>,
    ) {
      const response = await handleMcpWorkspaceRequest(
        new Request("http://localhost:3000/mcp/workspace", {
          method: "POST",
          headers: {
            host: "localhost:3000",
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
        deps,
      );
      return (await response.json()) as {
        result: {
          tools?: { name: string }[];
          isError?: boolean;
          structuredContent?: Json;
          content?: { text: string }[];
        };
      };
    }

    beforeAll(async () => {
      await cleanup();
      await admin.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
       values ('${ids.organizationA}', '${ids.workspaceA}', 'portfolio', 'enabled', '${ids.userA}')`,
      );
      shirt = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "product",
          title: "Camiseta Básica",
          status: "active",
          categories: [{ value: "Vestuário", taxonomy: "merchant" }],
          ai_keywords: ["tshirt"],
          ai_do_not_say: ["promoção relâmpago"],
          variants: [
            {
              title: "Azul P",
              sku: "F5D-AZ-P",
              price: brl(4990),
              options: [
                { name: "Cor", label: "Azul" },
                { name: "Tamanho", label: "P" },
              ],
            },
            {
              title: "Azul M",
              sku: "F5D-AZ-M",
              price: brl(4990),
              options: [
                { name: "Cor", label: "Azul" },
                { name: "Tamanho", label: "M" },
              ],
            },
            {
              title: "Preta P",
              sku: "F5D-PR-P",
              price: brl(5990),
              availability_status: "out_of_stock",
              options: [
                { name: "Cor", label: "Preta" },
                { name: "Tamanho", label: "P" },
              ],
            },
          ],
        }),
      );
      consult = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "service",
          title: "Projeto de interiores",
          status: "active",
          price_display: "quote",
          ai_safety_rules: "Nunca prometa prazo sem a arquiteta.",
          variants: [{ title: "Projeto completo" }],
        }),
      );
      hidden = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "product",
          title: "Camiseta interna",
          status: "active",
          ai_discovery_enabled: false,
          variants: [{ title: "Única", price: brl(1000) }],
        }),
      );
      await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "product",
          title: "Camiseta rascunho",
          variants: [{ title: "Única", price: brl(1000) }],
        }),
      );
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await admin.$disconnect();
    });

    it("searches in UCP: only active, public, AI-enabled items with a price", async () => {
      const all = await run(owner, (tx) =>
        searchCatalog(tx, owner, { query: "camiseta" }),
      );
      expect(
        ucpErrors("shopping/catalog_search.json#/$defs/search_response", all),
      ).toEqual([]);
      const products = all.products as Json[];
      expect(products.map((p) => p.id)).toEqual([shirt.id]);
      expect(all.ucp).toEqual({
        version: "2026-08-25",
        capabilities: {
          "dev.ucp.shopping.catalog.search": [{ version: "2026-08-25" }],
        },
      });
      // The AI keywords find the item and never leave.
      const byKeyword = await run(owner, (tx) =>
        searchCatalog(tx, owner, { query: "tshirt" }),
      );
      expect((byKeyword.products as Json[]).map((p) => p.id)).toEqual([
        shirt.id,
      ]);
      expect(JSON.stringify(byKeyword)).not.toMatch(/tshirt|relâmpago|ai_/);
      // Quote items are offered only by our agent.
      const quote = await run(owner, (tx) =>
        searchCatalog(tx, owner, { query: "interiores" }),
      );
      expect(quote.products).toEqual([]);

      // Price filter narrows the variants; categories filter the products.
      const cheap = await run(owner, (tx) =>
        searchCatalog(tx, owner, {
          filters: { price: { max: 5000 }, categories: ["Vestuário"] },
        }),
      );
      const [found] = cheap.products as Json[];
      expect((found!.variants as Json[]).map((v) => v.sku)).toEqual([
        "F5D-AZ-P",
        "F5D-AZ-M",
      ]);
      const none = await run(owner, (tx) =>
        searchCatalog(tx, owner, { filters: { categories: ["Calçados"] } }),
      );
      expect(none.products).toEqual([]);
      expect(none.pagination).toEqual({ has_next_page: false, total_count: 0 });

      // Pagination by cursor.
      const extra = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "product",
          title: "Camiseta Listrada",
          status: "active",
          variants: [{ title: "Única", price: brl(3990) }],
        }),
      );
      const first = await run(owner, (tx) =>
        searchCatalog(tx, owner, {
          query: "camiseta",
          pagination: { limit: 1 },
        }),
      );
      expect(first.pagination).toMatchObject({
        has_next_page: true,
        total_count: 2,
      });
      const second = await run(owner, (tx) =>
        searchCatalog(tx, owner, {
          query: "camiseta",
          pagination: {
            limit: 1,
            cursor: (first.pagination as { cursor: string }).cursor,
          },
        }),
      );
      expect(
        [...(first.products as Json[]), ...(second.products as Json[])]
          .map((p) => p.id)
          .sort(),
      ).toEqual([shirt.id, extra.id].sort());
      expect(second.pagination).toMatchObject({ has_next_page: false });
      await expect(
        run(owner, (tx) =>
          searchCatalog(tx, owner, { pagination: { cursor: "nope" } }),
        ),
      ).rejects.toBeInstanceOf(AppError);
    });

    it("looks up by product id, variant id, SKU and handle, with inputs", async () => {
      const blueM = shirt.variants[1]!;
      const response = await run(owner, (tx) =>
        lookupCatalog(tx, owner, {
          ids: [
            shirt.id,
            blueM.id,
            "F5D-PR-P",
            "camiseta-basica",
            shirt.id,
            consult.id,
            "nao-existe",
          ],
        }),
      );
      expect(
        ucpErrors(
          "shopping/catalog_lookup.json#/$defs/lookup_response",
          response,
        ),
      ).toEqual([]);
      const products = response.products as Json[];
      expect(products).toHaveLength(1);
      const variants = products[0]!.variants as Json[];
      expect(
        Object.fromEntries(variants.map((v) => [v.sku, v.inputs])),
      ).toEqual({
        "F5D-AZ-P": [
          { id: shirt.id, match: "featured" },
          { id: "camiseta-basica", match: "featured" },
        ],
        "F5D-AZ-M": [{ id: blueM.id, match: "exact" }],
        "F5D-PR-P": [{ id: "F5D-PR-P", match: "exact" }],
      });
      // Quote and unknown ids are not found; nothing reveals the quote item.
      expect(response.messages).toEqual([
        { type: "info", code: "not_found", content: consult.id },
        { type: "info", code: "not_found", content: "nao-existe" },
      ]);
      await expect(
        run(owner, (tx) =>
          lookupCatalog(tx, owner, {
            ids: Array.from({ length: 51 }, (_, i) => `id-${i}`),
          }),
        ),
      ).rejects.toThrow(/no máximo 50/);
    });

    it("gets a product with option selection and availability signals", async () => {
      const plain = await run(owner, (tx) =>
        getCatalogProduct(tx, owner, { id: shirt.id }),
      );
      expect(
        ucpErrors(
          "shopping/catalog_lookup.json#/$defs/get_product_response",
          plain,
        ),
      ).toEqual([]);
      const product = plain.product as Json;
      expect(product.selected).toEqual([
        { name: "Cor", label: "Azul" },
        { name: "Tamanho", label: "P" },
      ]);
      expect((product.variants as Json[]).map((v) => v.sku)).toEqual([
        "F5D-AZ-P",
      ]);
      expect(product.options).toEqual([
        {
          name: "Cor",
          values: [
            { label: "Azul", exists: true, available: true },
            { label: "Preta", exists: true, available: false },
          ],
        },
        {
          name: "Tamanho",
          values: [
            { label: "P", exists: true, available: true },
            { label: "M", exists: true, available: true },
          ],
        },
      ]);

      // Preta + M does not exist: Tamanho (last preference) is relaxed.
      const relaxed = (
        await run(owner, (tx) =>
          getCatalogProduct(tx, owner, {
            id: shirt.id,
            selected: [
              { name: "Cor", label: "Preta" },
              { name: "Tamanho", label: "M" },
            ],
            preferences: ["Cor", "Tamanho"],
          }),
        )
      ).product as Json;
      expect(relaxed.selected).toEqual([{ name: "Cor", label: "Preta" }]);
      expect((relaxed.variants as Json[]).map((v) => v.sku)).toEqual([
        "F5D-PR-P",
      ]);

      // A variant id fixes the selection and comes first.
      const byVariant = (
        await run(owner, (tx) =>
          getCatalogProduct(tx, owner, {
            id: shirt.variants[1]!.id,
            selected: [{ name: "Cor", label: "Preta" }],
          }),
        )
      ).product as Json;
      expect((byVariant.variants as Json[])[0]!.id).toBe(shirt.variants[1]!.id);
      expect(byVariant.selected).toEqual([
        { name: "Cor", label: "Azul" },
        { name: "Tamanho", label: "M" },
      ]);

      // Not found is an application outcome.
      for (const id of [hidden.id, consult.id, "nada"]) {
        const missing = await run(owner, (tx) =>
          getCatalogProduct(tx, owner, { id }),
        );
        expect(ucpErrors("common/types/error_response.json", missing)).toEqual(
          [],
        );
        expect(missing).toMatchObject({
          ucp: { status: "error" },
          messages: [{ code: "not_found", severity: "unrecoverable" }],
        });
      }
    });

    it("gives our agent the quote items and the AI governance", async () => {
      const page = await run(owner, (tx) => agentSearch(tx, owner, {}));
      const byId = new Map(page.items.map((i) => [i.id, i]));
      expect(byId.has(hidden.id)).toBe(false);
      expect(byId.get(consult.id)).toMatchObject({
        price_display: "quote",
        ucp_visible: false,
        product: null,
        quote_variants: [{ title: "Projeto completo" }],
        governance: { safety_rules: "Nunca prometa prazo sem a arquiteta." },
      });
      expect(byId.get(shirt.id)).toMatchObject({
        ucp_visible: true,
        governance: {
          keywords: ["tshirt"],
          do_not_say: ["promoção relâmpago"],
        },
      });
      const services = await run(owner, (tx) =>
        agentSearch(tx, owner, { item_type: "service", query: "interiores" }),
      );
      expect(services.items.map((i) => i.id)).toEqual([consult.id]);
      await expect(
        run(owner, (tx) => agentGetItem(tx, owner, hidden.id)),
      ).rejects.toThrow(/não encontrado/);
      // Members read; the module state applies.
      expect(
        (await run(viewer, (tx) => agentGetItem(tx, viewer, consult.id))).id,
      ).toBe(consult.id);
    });

    it("serves the REST API and the MCP by scope", async () => {
      const reader = await createKey(["portfolio:read"]);
      const search = await rest("searchPortfolioCatalog", {
        key: reader.raw,
        body: { query: "camiseta" },
      });
      expect(search.status).toBe(200);
      expect(
        ucpErrors(
          "shopping/catalog_search.json#/$defs/search_response",
          search.body,
        ),
      ).toEqual([]);
      expect((search.body.products as Json[]).length).toBeGreaterThan(0);
      const product = await rest("getPortfolioCatalogProduct", {
        key: reader.raw,
        body: { id: "nada" },
      });
      expect(product.status).toBe(200);
      expect(product.body).toMatchObject({ ucp: { status: "error" } });
      expect(
        (
          await rest("searchPortfolioForAgent", {
            key: reader.raw,
            query: "?query=interiores",
          })
        ).status,
      ).toBe(403);

      const agent = await createKey(["portfolio:agent"]);
      const agentPage = await rest("searchPortfolioForAgent", {
        key: agent.raw,
        query: "?query=interiores",
      });
      expect(agentPage.status).toBe(200);
      expect((agentPage.body.data as Json[])[0]).toMatchObject({
        id: consult.id,
        governance: { safety_rules: "Nunca prometa prazo sem a arquiteta." },
      });
      expect(
        (
          await rest("getPortfolioItemForAgent", {
            key: agent.raw,
            params: { itemId: consult.id },
          })
        ).status,
      ).toBe(200);

      // Writes through the REST API with portfolio:write.
      const writer = await createKey(["portfolio:write"]);
      const created = await rest("createPortfolioItem", {
        key: writer.raw,
        body: {
          item_type: "product",
          title: "Boné API",
          variants: [{ title: "Único", sku: "F5D-BONE", price: brl(2990) }],
        },
      });
      expect(created.status).toBe(201);
      const item = created.body.data as Json & { variants: Json[] };
      expect(item).toMatchObject({ title: "Boné API", status: "draft" });
      const patched = await rest("updatePortfolioVariant", {
        key: writer.raw,
        params: {
          itemId: String(item.id),
          variantId: String(item.variants[0]!.id),
        },
        body: { price: brl(2490) },
      });
      expect(patched.status).toBe(200);
      expect(
        (patched.body.data as { variants: Json[] }).variants[0]!.priceAmount,
      ).toBe(2490);
      expect(
        (
          await rest("updatePortfolioItem", {
            key: reader.raw,
            params: { itemId: String(item.id) },
            body: { title: "x" },
          })
        ).status,
      ).toBe(403);

      // A viewer cannot hold portfolio:write.
      await expect(
        run(viewer, (tx) =>
          createApiKey(tx, viewer, {
            name: "Viewer",
            scopes: ["portfolio:write"],
            expiresInDays: 1,
          }),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      // MCP: the tools follow the scopes; the UCP binding takes `catalog`.
      const both = await createKey(["portfolio:read", "portfolio:agent"]);
      const tools = (await mcp(both.raw, "tools/list", {})).result.tools!.map(
        (t) => t.name,
      );
      expect(tools).toEqual(
        expect.arrayContaining([
          "search_catalog",
          "lookup_catalog",
          "get_product",
          "search_portfolio",
          "get_portfolio_item",
        ]),
      );
      expect(
        (await mcp(reader.raw, "tools/list", {})).result.tools!.map(
          (t) => t.name,
        ),
      ).not.toContain("search_portfolio");
      const called = await mcp(both.raw, "tools/call", {
        name: "search_catalog",
        arguments: {
          meta: {
            "ucp-agent": { profile: "https://agent.example/profile.json" },
          },
          catalog: { query: "camiseta", filters: { price: { max: 5000 } } },
        },
      });
      expect(called.result.isError).toBeFalsy();
      expect(
        ucpErrors(
          "shopping/catalog_search.json#/$defs/search_response",
          called.result.structuredContent,
        ),
      ).toEqual([]);
      const lookup = await mcp(both.raw, "tools/call", {
        name: "lookup_catalog",
        arguments: { catalog: { ids: ["F5D-AZ-M"] } },
      });
      expect(
        (
          (lookup.result.structuredContent!.products as Json[])[0]!
            .variants as Json[]
        )[0],
      ).toMatchObject({ sku: "F5D-AZ-M", inputs: [{ match: "exact" }] });
      const agentCall = await mcp(both.raw, "tools/call", {
        name: "get_portfolio_item",
        arguments: { itemId: consult.id },
      });
      expect(agentCall.result.structuredContent).toMatchObject({
        price_display: "quote",
      });

      // The module disabled hides the tools.
      await admin.$executeRawUnsafe(
        `update public.workspace_modules set status = 'disabled'
       where workspace_id = '${ids.workspaceA}' and module_key = 'portfolio'`,
      );
      try {
        expect(
          (await mcp(both.raw, "tools/list", {})).result.tools!.map(
            (t) => t.name,
          ),
        ).not.toContain("search_catalog");
        expect(
          (
            await rest("searchPortfolioCatalog", {
              key: reader.raw,
              body: {},
            })
          ).status,
        ).not.toBe(200);
      } finally {
        await admin.$executeRawUnsafe(
          `update public.workspace_modules set status = 'enabled'
         where workspace_id = '${ids.workspaceA}' and module_key = 'portfolio'`,
        );
      }
    });

    it("changes price and availability only through an approved proposal", async () => {
      const key = await createKey(["proposals:write", "portfolio:read"]);
      const keyCtx: RequestContext = {
        ...contextA,
        principalType: "api_key",
        grantId: key.id,
      };
      const variant = shirt.variants[0]!;
      const { proposal } = await run(keyCtx, (tx) =>
        createProposal(tx, keyCtx, {
          operation: "portfolio.variants.update",
          targetId: variant.id,
          payload: { price: brl(3990), availability_status: "backorder" },
          idempotencyKey: `f5d-${randomUUID()}`,
        }),
      );
      expect(proposal.status).toBe("pending");
      // Nothing changed yet.
      expect(
        Number(
          (
            await admin.portfolioVariant.findUnique({
              where: { id: variant.id },
            })
          )?.priceAmount,
        ),
      ).toBe(4990);
      // Only price, list price, availability and stock may be proposed.
      await expect(
        run(keyCtx, (tx) =>
          createProposal(tx, keyCtx, {
            operation: "portfolio.variants.update",
            targetId: variant.id,
            payload: { sku: "OUTRO" },
            idempotencyKey: `f5d-${randomUUID()}`,
          }),
        ),
      ).rejects.toBeInstanceOf(AppError);

      await run(owner, (tx) =>
        approveProposal(
          tx,
          owner,
          proposal.id,
          { payloadHash: proposal.payloadHash },
          { mfaVerified: true },
        ),
      );
      await run(owner, (tx) => executeProposal(tx, owner, proposal.id));
      const after = await admin.portfolioVariant.findUnique({
        where: { id: variant.id },
      });
      expect(Number(after?.priceAmount)).toBe(3990);
      expect(after?.availabilityStatus).toBe("backorder");

      // An item proposed by the agent is created as the person approves it.
      const { proposal: create } = await run(keyCtx, (tx) =>
        createProposal(tx, keyCtx, {
          operation: "portfolio.items.create",
          payload: {
            item_type: "product",
            title: "Caneca proposta",
            variants: [{ title: "Única", price: brl(3500) }],
          },
          idempotencyKey: `f5d-${randomUUID()}`,
        }),
      );
      await run(owner, (tx) =>
        approveProposal(
          tx,
          owner,
          create.id,
          { payloadHash: create.payloadHash },
          { mfaVerified: true },
        ),
      );
      const done = await run(owner, (tx) =>
        executeProposal(tx, owner, create.id),
      );
      expect(done).toMatchObject({ status: "executed" });
      expect(
        await admin.portfolioItem.count({
          where: { workspaceId: ids.workspaceA, title: "Caneca proposta" },
        }),
      ).toBe(1);
    });
  },
);
