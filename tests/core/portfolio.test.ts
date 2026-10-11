import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createLocation, updateLocation } from "@/core/locations/service";
import { loadUsage } from "@/core/entitlements/usage";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import {
  addAccommodationType,
  addRatePlan,
  addVariant,
  createItem,
  getItem,
  itemToUcp,
  listItems,
  removeAccommodationType,
  removeRatePlan,
  removeVariant,
  updateAccommodationType,
  updateRatePlan,
  updateItem,
  updateVariant,
} from "@/modules/portfolio/server";
import { AppError } from "@/shared/errors";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";
import { ucpErrors } from "../unit/support/ucp";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const owner: RequestContext = { ...contextA, principalType: "user" };
const viewer: RequestContext = { ...owner, userId: ids.userMultiOrg };

const brl = (amount: number) => ({ amount, currency: "BRL" });

describeDatabase(
  "F5a: Portfolio items, variants and locations",
  requiredVars,
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });
    const run = <T>(
      ctx: RequestContext,
      fn: Parameters<typeof withContext<T>>[2],
    ) => withContext(prisma, ctx, fn);

    async function setModule(
      workspace: string,
      organization: string,
      user: string,
      status: string,
    ) {
      await admin.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
       values ('${organization}', '${workspace}', 'portfolio', '${status}', '${user}')
       on conflict (workspace_id, module_key) do update set status = excluded.status`,
      );
    }

    async function cleanup() {
      for (const t of [
        "portfolio_variants",
        "portfolio_accommodation_types",
        "portfolio_rate_plans",
        "portfolio_items",
        "workspace_locations",
      ]) {
        await admin.$executeRawUnsafe(
          `delete from public.${t} where workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
        );
      }
      await admin.$executeRawUnsafe(
        `delete from public.workspace_modules where module_key = 'portfolio'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.platform_modules where module_key = 'portfolio'`,
      );
    }

    beforeAll(async () => {
      await cleanup();
      await setModule(ids.workspaceA, ids.organizationA, ids.userA, "enabled");
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await admin.$disconnect();
    });

    it("creates an item with variants and serves it as a valid UCP product", async () => {
      const created = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "product",
          title: "Camiseta Básica",
          description: { plain: "Algodão 100%." },
          categories: [
            { value: "Vestuário > Camisetas", taxonomy: "merchant" },
          ],
          media: [{ type: "image", url: "https://cdn.test/camiseta.jpg" }],
          status: "active",
          ai_keywords: ["camisa"],
          ai_do_not_say: ["promoção relâmpago"],
          variants: [
            {
              title: "Azul / M",
              sku: "CAM-AZ-M",
              barcodes: [{ type: "EAN", value: "7891234567895" }],
              price: brl(4990),
              list_price: brl(5990),
              options: [
                { name: "Cor", label: "Azul" },
                { name: "Tamanho", label: "M" },
              ],
            },
            {
              title: "Preta / G",
              sku: "CAM-PR-G",
              price: brl(5490),
              options: [
                { name: "Cor", label: "Preta" },
                { name: "Tamanho", label: "G" },
              ],
              track_inventory: true,
              stock_quantity: 0,
            },
          ],
        }),
      );
      expect(created).toMatchObject({
        handle: "camiseta-basica",
        itemType: "product",
      });
      expect(created.variants.map((v) => v.position)).toEqual([0, 1]);

      const ucp = itemToUcp(created)!;
      expect(ucpErrors("shopping/types/product.json", ucp)).toEqual([]);
      expect(ucp).toMatchObject({
        price_range: { min: brl(4990), max: brl(5490) },
        variants: [
          {
            sku: "CAM-AZ-M",
            list_price: brl(5990),
            availability: { status: "in_stock" },
          },
          {
            sku: "CAM-PR-G",
            availability: { available: false, status: "out_of_stock" },
          },
        ],
      });
      expect(JSON.stringify(ucp)).not.toContain("promoção relâmpago");

      // Same title again: a free handle is chosen.
      const again = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "product",
          title: "Camiseta Básica",
          variants: [{ title: "Única", price: brl(1000) }],
        }),
      );
      expect(again.handle).toBe("camiseta-basica-2");

      const list = await run(owner, (tx) =>
        listItems(tx, owner, { search: "camiseta" }),
      );
      expect(list.items).toHaveLength(2);
    });

    it("validates prices, SKUs, item types and keeps at least one variant", async () => {
      const reject = (input: Record<string, unknown>) =>
        expect(
          run(owner, (tx) =>
            createItem(tx, owner, {
              item_type: "product",
              title: "X",
              ...input,
            }),
          ),
        ).rejects.toBeInstanceOf(AppError);
      await reject({ variants: [{ title: "Sem preço" }] });
      await reject({ variants: [] });
      await reject({
        item_type: "vehicle",
        variants: [{ title: "A", price: brl(1) }],
      });
      await reject({
        variants: [{ title: "A", price: brl(5000), list_price: brl(4000) }],
      });
      await reject({
        variants: [{ title: "Dup", sku: "CAM-AZ-M", price: brl(1) }],
      });
      await reject({
        variants: [{ title: "A", price: brl(1) }],
        location_ids: ["00000000-0000-4000-8000-000000000001"],
      });

      // Quote items need no price and never leave through UCP.
      const quote = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "product",
          title: "Projeto sob medida",
          price_display: "quote",
          status: "active",
          variants: [{ title: "Sob consulta" }],
        }),
      );
      expect(itemToUcp(quote)).toBeNull();

      const single = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "product",
          title: "Caneca",
          variants: [
            {
              title: "Branca",
              price: brl(2500),
              availability_status: "preorder",
            },
          ],
        }),
      );
      await expect(
        run(owner, (tx) =>
          removeVariant(tx, owner, single.id, single.variants[0]!.id),
        ),
      ).rejects.toBeInstanceOf(AppError);
      const two = await run(owner, (tx) =>
        addVariant(tx, owner, single.id, { title: "Preta", price: brl(2700) }),
      );
      expect(two.variants).toHaveLength(2);
      const one = await run(owner, (tx) =>
        removeVariant(tx, owner, single.id, two.variants[1]!.id),
      );
      expect(one.variants).toHaveLength(1);

      // A partial update changes only what was sent.
      const updated = await run(owner, (tx) =>
        updateVariant(tx, owner, single.id, single.variants[0]!.id, {
          price: brl(2600),
        }),
      );
      expect(updated.variants[0]).toMatchObject({
        priceAmount: 2600,
        availabilityStatus: "preorder",
        title: "Branca",
      });
      const renamed = await run(owner, (tx) =>
        updateItem(tx, owner, single.id, { title: "Caneca Grande" }),
      );
      expect(renamed).toMatchObject({
        title: "Caneca Grande",
        handle: "caneca",
      });
    });

    it("links active locations in the UCP shape and lets only owner and admin manage them", async () => {
      const store = await run(owner, (tx) =>
        createLocation(tx, owner, {
          name: "Loja Centro",
          address: {
            street_address: "Rua A, 10",
            address_locality: "São Paulo",
            address_region: "SP",
            address_country: "BR",
            postal_code: "01000-000",
          },
          geo: { latitude: -23.55, longitude: -46.63 },
          hours: [{ day: "monday", opens: "09:00", closes: "18:00" }],
          amenities: {
            "dev.ucp.amenity.parking": { description: "Estacionamento" },
          },
        }),
      );
      const { geo, timezone, hours, amenities, address, id, name } = store;
      expect(
        ucpErrors("common/types/location.json", {
          id,
          name,
          address,
          geo,
          timezone,
          hours,
          amenities,
        }),
      ).toEqual([]);
      await expect(
        run(owner, (tx) =>
          createLocation(tx, owner, { name: "X", timezone: "Lua/Base" }),
        ),
      ).rejects.toBeInstanceOf(AppError);
      await expect(
        run(viewer, (tx) => createLocation(tx, viewer, { name: "Viewer" })),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      const item = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "product",
          title: "Retirada na loja",
          fulfillment_methods: ["pickup"],
          location_ids: [store.id],
          variants: [{ title: "Única", price: brl(100) }],
        }),
      );
      expect(item.locationIds).toEqual([store.id]);
      // A partial location update keeps the time zone.
      const kept = await run(owner, (tx) =>
        updateLocation(tx, owner, store.id, { name: "Loja Centro 2" }),
      );
      expect(kept.timezone).toBe("America/Sao_Paulo");
      await run(owner, (tx) =>
        updateLocation(tx, owner, store.id, { status: "inactive" }),
      );
      await expect(
        run(owner, (tx) =>
          updateItem(tx, owner, item.id, { location_ids: [store.id] }),
        ),
      ).rejects.toBeInstanceOf(AppError);
    });

    it("lets the viewer read only, isolates workspaces and follows the module state", async () => {
      const items = await run(viewer, (tx) => listItems(tx, viewer));
      expect(items.items.length).toBeGreaterThan(0);
      await expect(
        run(viewer, (tx) =>
          createItem(tx, viewer, {
            item_type: "product",
            title: "Viewer",
            variants: [{ title: "A", price: brl(1) }],
          }),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      const someId = items.items[0]!.id;
      await setModule(ids.workspaceB, ids.organizationB, ids.userB, "enabled");
      await expect(
        run(contextB, (tx) => getItem(tx, contextB, someId)),
      ).rejects.toBeInstanceOf(AppError);

      await setModule(ids.workspaceA, ids.organizationA, ids.userA, "disabled");
      try {
        await expect(
          run(owner, (tx) => listItems(tx, owner)),
        ).rejects.toThrow();
      } finally {
        await setModule(
          ids.workspaceA,
          ids.organizationA,
          ids.userA,
          "enabled",
        );
      }
    });

    it("validates the details of each vertical and sends them through UCP metadata (F5b)", async () => {
      const service = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "service",
          vertical: "healthcare",
          title: "Consulta odontológica",
          status: "active",
          fulfillment_methods: ["pickup", "digital"],
          details: {
            duration_minutes: 50,
            professional_registry: {
              type: "cro",
              number: "12345",
              region: "SP",
            },
            insurance_providers: ["Amil", "Bradesco Saúde"],
            patient_type: "human",
          },
          variants: [
            {
              title: "Consulta",
              price: brl(25000),
              quantity_unit: { unit: "C62", display_text: "consulta" },
            },
          ],
        }),
      );
      expect(service).toMatchObject({
        itemType: "service",
        vertical: "healthcare",
      });
      const ucp = itemToUcp(service)!;
      expect(ucpErrors("shopping/types/product.json", ucp)).toEqual([]);
      expect(ucp.metadata).toMatchObject({
        "co.guidu.portfolio.service.healthcare": { duration_minutes: 50 },
      });

      // Wrong vertical, a field of another vertical, the pilot's camelCase.
      for (const input of [
        { item_type: "product", vertical: "healthcare" },
        {
          item_type: "service",
          vertical: "healthcare",
          details: { treated_areas: ["Rosto"] },
        },
        {
          item_type: "service",
          vertical: "aesthetics",
          details: { treatedAreas: ["Rosto"] },
        },
      ]) {
        await expect(
          run(owner, (tx) =>
            createItem(tx, owner, {
              title: "Inválido",
              variants: [{ title: "A", price: brl(1) }],
              ...input,
            }),
          ),
        ).rejects.toBeInstanceOf(AppError);
      }

      // A draft property may be incomplete; activating needs the required details.
      const flat = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "real_estate",
          title: "Apartamento 2 quartos",
          details: { bedrooms: 2 },
          variants: [
            {
              title: "Aluguel",
              price: brl(320000),
              quantity_unit: { unit: "MON", display_text: "mês" },
            },
          ],
        }),
      );
      await expect(
        run(owner, (tx) =>
          updateItem(tx, owner, flat.id, { status: "active" }),
        ),
      ).rejects.toBeInstanceOf(AppError);
      const active = await run(owner, (tx) =>
        updateItem(tx, owner, flat.id, {
          status: "active",
          details: {
            bedrooms: 2,
            operation_type: "rent",
            property_type: "apartment",
            condo_fee: 85000,
          },
        }),
      );
      expect(active.details).toMatchObject({
        operation_type: "rent",
        condo_fee: 85000,
      });
      expect(
        ucpErrors("shopping/types/product.json", itemToUcp(active)),
      ).toEqual([]);

      const event = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "event",
          title: "Workshop de café",
          status: "active",
          details: {
            starts_at: "2026-11-20T19:00:00-03:00",
            topics: ["Espresso"],
          },
          variants: [
            { title: "Individual", price: brl(9000) },
            { title: "Dupla", price: brl(16000) },
          ],
        }),
      );
      expect(event.variants).toHaveLength(2);
      await expect(
        run(owner, (tx) =>
          createItem(tx, owner, {
            item_type: "event",
            title: "Sem data",
            status: "active",
            variants: [{ title: "Individual", price: brl(1) }],
          }),
        ),
      ).rejects.toBeInstanceOf(AppError);

      const services = await run(owner, (tx) =>
        listItems(tx, owner, { item_type: "service" }),
      );
      expect(services.items.map((i) => i.id)).toEqual([service.id]);
    });

    it("registers lodging in the UCP lodging model (F5c)", async () => {
      const inn = await run(owner, (tx) =>
        createLocation(tx, owner, {
          name: "Pousada Mar",
          address: {
            street_address: "Av. Beira-Mar, 100",
            address_locality: "Ubatuba",
            address_region: "SP",
            address_country: "BR",
          },
          geo: { latitude: -23.43, longitude: -45.07 },
        }),
      );
      const other = await run(owner, (tx) =>
        createLocation(tx, owner, { name: "Outra pousada" }),
      );

      // Created as a draft with a default type and plan; the price is per night.
      const draft = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "lodging",
          title: "Pousada Mar",
          details: { check_in_time: "14:00" },
          variants: [{ title: "Diária", price: brl(45000) }],
        }),
      );
      expect(draft.lodging?.accommodationTypes.map((t) => t.title)).toEqual([
        "Pousada Mar",
      ]);
      expect(draft.lodging?.ratePlans.map((p) => p.title)).toEqual([
        "Tarifa padrão",
      ]);
      expect(draft.variants[0]).toMatchObject({
        accommodationTypeId: draft.lodging?.accommodationTypes[0]?.id,
        ratePlanId: draft.lodging?.ratePlans[0]?.id,
        quantityUnit: { unit: "DAY", display_text: "diária" },
      });

      // Activating needs the house rules, the property, capacity and links.
      const activate = (input: Record<string, unknown>) =>
        run(owner, (tx) =>
          updateItem(tx, owner, draft.id, { status: "active", ...input }),
        );
      await expect(activate({})).rejects.toThrow(/check_out_time/);
      const rules = {
        check_in_time: "14:00",
        check_out_time: "11:00",
        quiet_hours: { opens: "22:00", closes: "08:00" },
        pets_allowed: true,
        cleaning_fee: 15000,
        amenities: ["dev.ucp.amenity.wi_fi", "co.guidu.amenity.pool"],
      };
      await expect(
        activate({ details: { ...rules, quiet_hours: { opens: "22:00" } } }),
      ).rejects.toThrow(/silêncio/);
      await expect(activate({ details: rules })).rejects.toThrow(/propriedade/);
      await expect(
        activate({ details: rules, location_ids: [inn.id, other.id] }),
      ).rejects.toThrow(/única propriedade/);
      await expect(
        activate({ details: rules, location_ids: [inn.id] }),
      ).rejects.toThrow(/capacidade/);

      const typeId = draft.lodging!.accommodationTypes[0]!.id;
      await run(owner, (tx) =>
        updateAccommodationType(tx, owner, draft.id, typeId, {
          title: "Suíte casal",
          accommodation_kind: "suite",
          capacity: {
            adults: 2,
            children: 1,
            child_age_ranges: [{ ages: { min: 0, max: 11 }, limit: 1 }],
            total: 3,
          },
          bedrooms: 1,
          beds_count: 1,
          bathrooms: 1,
          amenities: ["co.guidu.amenity.air_conditioning"],
        }),
      );
      await expect(
        run(owner, (tx) =>
          updateAccommodationType(tx, owner, draft.id, typeId, {
            capacity: { adults: 4, total: 2 },
          }),
        ),
      ).rejects.toBeInstanceOf(AppError);
      const active = await activate({
        details: rules,
        location_ids: [inn.id],
      });
      expect(active.status).toBe("active");

      // A second type and a non-refundable plan, priced as a new variant.
      const withChalet = await run(owner, (tx) =>
        addAccommodationType(tx, owner, draft.id, {
          title: "Chalé família",
          accommodation_kind: "chalet",
          capacity: { adults: 4, children: 2, total: 5 },
        }),
      );
      const chalet = withChalet.lodging!.accommodationTypes[1]!;
      const withPlan = await run(owner, (tx) =>
        addRatePlan(tx, owner, draft.id, {
          title: "Não reembolsável com café",
          refundability: "non_refundable",
          board: "breakfast",
        }),
      );
      const nonRefundable = withPlan.lodging!.ratePlans[1]!;
      await run(owner, (tx) =>
        updateRatePlan(
          tx,
          owner,
          draft.id,
          withPlan.lodging!.ratePlans[0]!.id,
          { free_cancellation_hours: 48, title: "Flexível" },
        ),
      );
      // An active item keeps every price bound to a type and a plan.
      await expect(
        run(owner, (tx) =>
          addVariant(tx, owner, draft.id, {
            title: "Sem vínculo",
            price: brl(1),
          }),
        ),
      ).rejects.toThrow(/acomodação e de uma tarifa/);
      const priced = await run(owner, (tx) =>
        addVariant(tx, owner, draft.id, {
          title: "Chalé — não reembolsável",
          price: brl(52000),
          accommodation_type_id: chalet.id,
          rate_plan_id: nonRefundable.id,
        }),
      );
      expect(priced.variants[1]?.quantityUnit).toEqual({
        unit: "DAY",
        display_text: "diária",
      });
      // Types and plans of another item are refused.
      const product = await run(owner, (tx) =>
        createItem(tx, owner, {
          item_type: "product",
          title: "Toalha",
          variants: [{ title: "A", price: brl(1) }],
        }),
      );
      await expect(
        run(owner, (tx) =>
          updateVariant(tx, owner, product.id, product.variants[0]!.id, {
            rate_plan_id: nonRefundable.id,
          }),
        ),
      ).rejects.toThrow(/só na hospedagem/);
      await expect(
        run(owner, (tx) =>
          addRatePlan(tx, owner, product.id, { title: "Tarifa" }),
        ),
      ).rejects.toThrow(/só na hospedagem/);
      // A type or plan in use stays; an unused one can go.
      await expect(
        run(owner, (tx) =>
          removeAccommodationType(tx, owner, draft.id, chalet.id),
        ),
      ).rejects.toThrow(/tem preços/);
      const spare = await run(owner, (tx) =>
        addRatePlan(tx, owner, draft.id, { title: "Sobra" }),
      );
      const afterRemove = await run(owner, (tx) =>
        removeRatePlan(tx, owner, draft.id, spare.lodging!.ratePlans[2]!.id),
      );
      expect(afterRemove.lodging?.ratePlans).toHaveLength(2);
      // The viewer reads only.
      await expect(
        run(viewer, (tx) =>
          addRatePlan(tx, viewer, draft.id, { title: "Viewer" }),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      // UCP: a valid Product; property, types and plans valid in the lodging schemas.
      const item = await run(owner, (tx) => getItem(tx, owner, draft.id));
      const ucp = itemToUcp(item) as Record<string, unknown>;
      expect(ucpErrors("shopping/types/product.json", ucp)).toEqual([]);
      const lodging = (ucp.metadata as Record<string, Record<string, unknown>>)[
        "co.guidu.portfolio.lodging"
      ]!;
      expect(lodging).toMatchObject({
        check_in_time: "14:00",
        pets_allowed: true,
        cleaning_fee: 15000,
      });
      expect(
        ucpErrors("lodging/types/property.json", lodging.property),
      ).toEqual([]);
      expect(lodging.property).toMatchObject({
        id: inn.id,
        name: "Pousada Mar",
        address: { address_locality: "Ubatuba" },
      });
      const types = lodging.accommodation_types as Record<string, unknown>[];
      const plans = lodging.rate_plans as Record<string, unknown>[];
      for (const t of types) {
        expect(ucpErrors("lodging/types/accommodation_type.json", t)).toEqual(
          [],
        );
      }
      for (const p of plans) {
        expect(ucpErrors("lodging/types/rate_plan.json", p)).toEqual([]);
        for (const policy of p.policies as unknown[]) {
          expect(
            ucpErrors(
              "lodging/policy_cancellation.json#/$defs/cancellation_item",
              policy,
            ),
          ).toEqual([]);
        }
      }
      expect(types[0]).toMatchObject({
        title: "Suíte casal",
        capacity: { adults: 2, total: 3 },
        "co.guidu.portfolio.accommodation_type": {
          accommodation_kind: "suite",
        },
      });
      expect(plans[0]).toMatchObject({
        title: "Flexível",
        policies: [
          {
            type: "dev.ucp.lodging.policy.cancellation",
            refundability: "refundable",
            description: {
              plain: "Cancelamento grátis até 48 horas antes do check-in.",
            },
          },
        ],
      });
      const variants = ucp.variants as Record<string, unknown>[];
      expect(variants[1]).toMatchObject({
        options: [
          { name: "Acomodação", label: "Chalé família" },
          { name: "Tarifa", label: "Não reembolsável com café" },
        ],
        metadata: {
          "co.guidu.portfolio.lodging": {
            accommodation_type_id: chalet.id,
            rate_plan_id: nonRefundable.id,
          },
        },
      });
      expect(JSON.stringify(ucp)).not.toContain("ai_");

      const listed = await run(owner, (tx) =>
        listItems(tx, owner, { item_type: "lodging" }),
      );
      expect(listed.items.map((i) => i.id)).toEqual([draft.id]);
      expect(listed.items[0]?.lodging?.property?.id).toBe(inn.id);
    });

    it("takes the default quota from the platform settings of the module", async () => {
      const count = await admin.portfolioItem.count({
        where: { workspaceId: ids.workspaceA },
      });
      await admin.$executeRawUnsafe(
        `insert into public.platform_modules (module_key, availability, config, updated_by)
       values ('portfolio', 'enabled', '{"quotaDefaults": {"portfolio.items": ${count}}}', 'd0000000-0000-4000-8000-000000000003')
       on conflict (module_key) do update set config = excluded.config`,
      );
      await expect(
        run(owner, (tx) =>
          createItem(tx, owner, {
            item_type: "product",
            title: "Acima do limite",
            variants: [{ title: "A", price: brl(1) }],
          }),
        ),
      ).rejects.toThrow(/Limite do plano atingido/);
      const usage = await run(owner, (tx) => loadUsage(tx, owner));
      expect(usage.rows.find((r) => r.key === "portfolio.items")).toMatchObject(
        {
          used: count,
          limit: count,
        },
      );
    });
  },
);
