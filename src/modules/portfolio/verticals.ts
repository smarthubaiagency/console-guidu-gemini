import { z } from "zod";

/**
 * Verticals of the Portfolio (F5b): the `details` extension of each
 * `item_type` and `vertical`, corrected from the pilot (Cartão Pro) to the
 * UCP conventions (docs/modules/portfolio/revisao-piloto.md): snake_case,
 * lowercase enums, money in minor units, measures as UCP `Measure`.
 *
 * One declaration per field drives the Zod schema, the form and the form
 * parsing, so the three never drift apart. In the UCP output the details
 * travel in `metadata` under `co.guidu.portfolio.<item_type>[.<vertical>]`.
 */

export const ITEM_TYPES = [
  "product",
  "service",
  "real_estate",
  "lodging",
  "event",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

type Option = Readonly<{ value: string; label: string }>;

export type FieldSpec = Readonly<
  {
    key: string;
    label: string;
    required?: boolean;
  } & (
    | { kind: "text"; max: number }
    | { kind: "textarea"; max: number }
    | { kind: "int"; min: number; max: number }
    | { kind: "money" }
    | { kind: "bool" }
    | { kind: "enum"; options: readonly Option[] }
    | { kind: "list"; max: number; each?: number }
    | { kind: "multi"; options: readonly Option[] }
    | {
        kind: "measure";
        unit: string;
        display_text: string;
        scale: number;
      }
    | { kind: "datetime" }
    | { kind: "time" }
  )
>;

const opts = (pairs: Record<string, string>): Option[] =>
  Object.entries(pairs).map(([value, label]) => ({ value, label }));

// ---------------------------------------------------------------------------
// Field declarations
// ---------------------------------------------------------------------------

const PRODUCT: readonly FieldSpec[] = [
  { key: "brand", label: "Marca", kind: "text", max: 80 },
  { key: "model", label: "Modelo", kind: "text", max: 80 },
  {
    key: "condition",
    label: "Condição",
    kind: "enum",
    options: opts({
      new: "Novo",
      used: "Usado",
      refurbished: "Recondicionado",
    }),
  },
  {
    key: "weight",
    label: "Peso (kg)",
    kind: "measure",
    unit: "KGM",
    display_text: "kg",
    scale: 3,
  },
  {
    key: "dimensions.length",
    label: "Comprimento (cm)",
    kind: "measure",
    unit: "CMT",
    display_text: "cm",
    scale: 1,
  },
  {
    key: "dimensions.width",
    label: "Largura (cm)",
    kind: "measure",
    unit: "CMT",
    display_text: "cm",
    scale: 1,
  },
  {
    key: "dimensions.height",
    label: "Altura (cm)",
    kind: "measure",
    unit: "CMT",
    display_text: "cm",
    scale: 1,
  },
  {
    key: "warranty_months",
    label: "Garantia (meses)",
    kind: "int",
    min: 0,
    max: 600,
  },
  {
    key: "attributes",
    label: "Características (uma por linha: nome: valor)",
    kind: "list",
    max: 30,
    each: 200,
  },
];

const SERVICE_BASE: readonly FieldSpec[] = [
  {
    key: "duration_minutes",
    label: "Duração (minutos)",
    kind: "int",
    min: 1,
    max: 100000,
  },
  {
    key: "capacity",
    label: "Capacidade (pessoas por atendimento)",
    kind: "int",
    min: 1,
    max: 100000,
  },
  { key: "service_type", label: "Tipo de serviço", kind: "text", max: 80 },
  { key: "specialties", label: "Especialidades", kind: "list", max: 30 },
  {
    key: "requirements",
    label: "Pré-requisitos",
    kind: "list",
    max: 30,
    each: 200,
  },
  { key: "callout_fee", label: "Taxa de visita (R$)", kind: "money" },
  {
    key: "min_hours",
    label: "Mínimo de horas",
    kind: "int",
    min: 0,
    max: 1000,
  },
  { key: "includes_materials", label: "Inclui materiais", kind: "bool" },
  {
    key: "min_notice_minutes",
    label: "Antecedência mínima (minutos)",
    kind: "int",
    min: 0,
    max: 100000,
  },
  {
    key: "warranty_days",
    label: "Garantia (dias)",
    kind: "int",
    min: 0,
    max: 3650,
  },
  {
    key: "service_area.coverage_type",
    label: "Área de atendimento",
    kind: "enum",
    options: opts({ radius: "Raio a partir da loja", cities: "Cidades" }),
  },
  {
    key: "service_area.radius_meters",
    label: "Raio (metros)",
    kind: "int",
    min: 1,
    max: 1000000,
  },
  {
    key: "service_area.cities",
    label: "Cidades atendidas",
    kind: "list",
    max: 100,
  },
  {
    key: "technical_notes",
    label: "Observações técnicas",
    kind: "textarea",
    max: 2000,
  },
];

const HEALTHCARE: readonly FieldSpec[] = [
  {
    key: "professional_registry.type",
    label: "Conselho profissional",
    kind: "enum",
    options: opts({
      crm: "CRM",
      cro: "CRO",
      crp: "CRP",
      crefito: "CREFITO",
      crn: "CRN",
      coren: "COREN",
      crmv: "CRMV",
      other: "Outro",
    }),
  },
  {
    key: "professional_registry.number",
    label: "Número do registro",
    kind: "text",
    max: 30,
  },
  {
    key: "professional_registry.region",
    label: "UF do registro",
    kind: "text",
    max: 2,
  },
  {
    key: "insurance_providers",
    label: "Convênios aceitos",
    kind: "list",
    max: 50,
  },
  {
    key: "patient_type",
    label: "Atende",
    kind: "enum",
    options: opts({ human: "Pessoas", animal: "Animais" }),
  },
  {
    key: "prescriptions_included",
    label: "Inclui receita/prescrição",
    kind: "bool",
  },
  { key: "emergency_service", label: "Atende urgência", kind: "bool" },
];

const AESTHETICS: readonly FieldSpec[] = [
  { key: "treated_areas", label: "Áreas tratadas", kind: "list", max: 30 },
  {
    key: "contraindications",
    label: "Contraindicações",
    kind: "list",
    max: 30,
    each: 200,
  },
  { key: "pre_care", label: "Cuidados antes", kind: "textarea", max: 2000 },
  { key: "post_care", label: "Cuidados depois", kind: "textarea", max: 2000 },
  {
    key: "sessions_recommended",
    label: "Sessões recomendadas",
    kind: "int",
    min: 1,
    max: 100,
  },
  {
    key: "session_interval_days",
    label: "Intervalo entre sessões (dias)",
    kind: "int",
    min: 0,
    max: 365,
  },
  {
    key: "single_session_possible",
    label: "Pode ser sessão única",
    kind: "bool",
  },
  {
    key: "recovery_time",
    label: "Recuperação",
    kind: "enum",
    options: opts({
      immediate: "Imediata",
      "24h": "24 horas",
      "48h_plus": "48 horas ou mais",
    }),
  },
  { key: "has_discomfort", label: "Pode causar desconforto", kind: "bool" },
  {
    key: "results_onset",
    label: "Quando aparecem os resultados",
    kind: "text",
    max: 120,
  },
];

const BEAUTY: readonly FieldSpec[] = [
  {
    key: "target_gender",
    label: "Público",
    kind: "enum",
    options: opts({ female: "Feminino", male: "Masculino", unisex: "Unissex" }),
  },
  {
    key: "target_age",
    label: "Faixa etária",
    kind: "enum",
    options: opts({ adult: "Adulto", child: "Infantil", all: "Todas" }),
  },
  {
    key: "scheduling_mode",
    label: "Atendimento",
    kind: "enum",
    options: opts({
      appointment: "Com hora marcada",
      walk_in: "Por ordem de chegada",
    }),
  },
  {
    key: "maintenance_level",
    label: "Manutenção",
    kind: "enum",
    options: opts({ low: "Baixa", medium: "Média", high: "Alta" }),
  },
];

const B2B_CORPORATE: readonly FieldSpec[] = [
  {
    key: "deliverables",
    label: "Entregáveis",
    kind: "list",
    max: 50,
    each: 200,
  },
  {
    key: "contract_models",
    label: "Modelos de contrato",
    kind: "multi",
    options: opts({
      retainer: "Mensalidade (retainer)",
      fixed_project: "Projeto fechado",
      time_and_materials: "Horas e materiais",
    }),
  },
  {
    key: "sla_hours",
    label: "SLA de resposta (horas)",
    kind: "int",
    min: 0,
    max: 10000,
  },
  {
    key: "project_phases",
    label: "Fases do projeto",
    kind: "list",
    max: 30,
    each: 200,
  },
  { key: "tools_used", label: "Ferramentas usadas", kind: "list", max: 50 },
];

const REAL_ESTATE: readonly FieldSpec[] = [
  {
    key: "operation_type",
    label: "Operação",
    kind: "enum",
    required: true,
    options: opts({ sale: "Venda", rent: "Aluguel" }),
  },
  {
    key: "property_type",
    label: "Tipo de imóvel",
    kind: "enum",
    required: true,
    options: opts({
      apartment: "Apartamento",
      house: "Casa",
      penthouse: "Cobertura",
      studio: "Studio",
      commercial: "Comercial",
      office: "Sala comercial",
      land: "Terreno",
      farm: "Sítio/fazenda",
    }),
  },
  {
    key: "usable_area",
    label: "Área útil (m²)",
    kind: "measure",
    unit: "MTK",
    display_text: "m²",
    scale: 2,
  },
  {
    key: "total_area",
    label: "Área total (m²)",
    kind: "measure",
    unit: "MTK",
    display_text: "m²",
    scale: 2,
  },
  { key: "bedrooms", label: "Quartos", kind: "int", min: 0, max: 100 },
  { key: "suites", label: "Suítes", kind: "int", min: 0, max: 100 },
  { key: "bathrooms", label: "Banheiros", kind: "int", min: 0, max: 100 },
  { key: "parking_spaces", label: "Vagas", kind: "int", min: 0, max: 100 },
  { key: "condo_fee", label: "Condomínio (R$/mês)", kind: "money" },
  { key: "property_tax", label: "IPTU (R$/ano)", kind: "money" },
  { key: "financing_available", label: "Aceita financiamento", kind: "bool" },
  {
    key: "furnished_status",
    label: "Mobília",
    kind: "enum",
    options: opts({
      furnished: "Mobiliado",
      semi_furnished: "Semimobiliado",
      unfurnished: "Sem mobília",
    }),
  },
  {
    key: "amenities",
    label: "Comodidades",
    kind: "multi",
    options: opts({
      "dev.ucp.amenity.parking": "Estacionamento",
      "co.guidu.amenity.pool": "Piscina",
      "co.guidu.amenity.gym": "Academia",
      "co.guidu.amenity.gourmet_balcony": "Varanda gourmet",
      "co.guidu.amenity.elevator": "Elevador",
      "co.guidu.amenity.concierge": "Portaria 24h",
      "co.guidu.amenity.playground": "Playground",
      "co.guidu.amenity.pet_friendly": "Aceita animais",
    }),
  },
];

/**
 * Lodging (F5c): the property's house rules, fees and amenities. The
 * property is the item's location (UCP Property); accommodation types and
 * rate plans have their own tables. Times use the UCP `time_interval`
 * format (HH:MM, 24 h).
 */
const LODGING: readonly FieldSpec[] = [
  {
    key: "check_in_time",
    label: "Check-in a partir de",
    kind: "time",
    required: true,
  },
  {
    key: "check_out_time",
    label: "Check-out até",
    kind: "time",
    required: true,
  },
  {
    key: "quiet_hours.opens",
    label: "Silêncio a partir de",
    kind: "time",
  },
  { key: "quiet_hours.closes", label: "Silêncio até", kind: "time" },
  {
    key: "min_nights",
    label: "Mínimo de diárias",
    kind: "int",
    min: 1,
    max: 365,
  },
  { key: "smoking_allowed", label: "Permite fumar", kind: "bool" },
  { key: "pets_allowed", label: "Aceita animais", kind: "bool" },
  { key: "parties_allowed", label: "Permite festas e eventos", kind: "bool" },
  {
    key: "house_rules",
    label: "Outras regras da casa (uma por linha)",
    kind: "list",
    max: 30,
    each: 200,
  },
  { key: "cleaning_fee", label: "Taxa de limpeza (R$)", kind: "money" },
  { key: "security_deposit", label: "Caução (R$)", kind: "money" },
  {
    key: "amenities",
    label: "Comodidades da propriedade",
    kind: "multi",
    options: opts({
      "dev.ucp.amenity.wi_fi": "Wi-Fi",
      "dev.ucp.amenity.parking": "Estacionamento",
      "co.guidu.amenity.pool": "Piscina",
      "co.guidu.amenity.air_conditioning": "Ar-condicionado",
      "co.guidu.amenity.kitchen": "Cozinha",
      "co.guidu.amenity.laundry": "Lavanderia",
      "co.guidu.amenity.barbecue": "Churrasqueira",
      "co.guidu.amenity.accessibility": "Acessibilidade",
    }),
  },
];

const EVENT: readonly FieldSpec[] = [
  { key: "starts_at", label: "Início", kind: "datetime", required: true },
  { key: "ends_at", label: "Término", kind: "datetime" },
  { key: "is_recurring", label: "Evento recorrente", kind: "bool" },
  {
    key: "recurrence",
    label: "Recorrência (ex.: toda sexta)",
    kind: "text",
    max: 120,
  },
  { key: "topics", label: "Temas", kind: "list", max: 30 },
  {
    key: "speakers",
    label: "Palestrantes / atrações",
    kind: "list",
    max: 50,
    each: 200,
  },
  {
    key: "age_rating",
    label: "Classificação etária",
    kind: "enum",
    options: opts({
      l: "Livre",
      "10": "10 anos",
      "12": "12 anos",
      "14": "14 anos",
      "16": "16 anos",
      "18": "18 anos",
    }),
  },
  { key: "target_audience", label: "Público-alvo", kind: "text", max: 200 },
  { key: "capacity", label: "Lotação", kind: "int", min: 1, max: 1000000 },
];

/** Verticals per item type, with their own fields after the base ones. */
const CATALOG: Readonly<
  Record<
    ItemType,
    Readonly<{
      label: string;
      base: readonly FieldSpec[];
      verticals: Readonly<
        Record<
          string,
          Readonly<{ label: string; fields: readonly FieldSpec[] }>
        >
      >;
    }>
  >
> = {
  product: {
    label: "Produto",
    base: PRODUCT,
    verticals: { general: { label: "Geral", fields: [] } },
  },
  service: {
    label: "Serviço",
    base: SERVICE_BASE,
    verticals: {
      general: { label: "Geral", fields: [] },
      healthcare: { label: "Saúde", fields: HEALTHCARE },
      aesthetics: { label: "Estética", fields: AESTHETICS },
      beauty: { label: "Beleza (salão e barbearia)", fields: BEAUTY },
      b2b_corporate: {
        label: "Corporativo e consultoria",
        fields: B2B_CORPORATE,
      },
    },
  },
  real_estate: {
    label: "Imóvel",
    base: REAL_ESTATE,
    verticals: { general: { label: "Geral", fields: [] } },
  },
  lodging: {
    label: "Hospedagem",
    base: LODGING,
    verticals: { general: { label: "Geral", fields: [] } },
  },
  event: {
    label: "Evento",
    base: EVENT,
    verticals: { general: { label: "Geral", fields: [] } },
  },
};

export function isItemType(value: string): value is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(value);
}

export function itemTypeLabel(itemType: string): string {
  return isItemType(itemType) ? CATALOG[itemType].label : itemType;
}

export function verticalLabel(itemType: string, vertical: string): string {
  if (!isItemType(itemType)) return vertical;
  return CATALOG[itemType].verticals[vertical]?.label ?? vertical;
}

/** Every valid "item_type:vertical" pair, for the creation form. */
export function listKinds(): { value: string; label: string }[] {
  return ITEM_TYPES.flatMap((type) =>
    Object.entries(CATALOG[type].verticals).map(([vertical, v]) => ({
      value: `${type}:${vertical}`,
      label:
        vertical === "general"
          ? CATALOG[type].label
          : `${CATALOG[type].label} — ${v.label}`,
    })),
  );
}

export function isValidKind(itemType: string, vertical: string): boolean {
  return isItemType(itemType) && vertical in CATALOG[itemType].verticals;
}

/** Fields of a kind: the type's base fields, then the vertical's. */
export function fieldsFor(
  itemType: string,
  vertical: string,
): readonly FieldSpec[] {
  if (!isValidKind(itemType, vertical)) return [];
  const entry = CATALOG[itemType as ItemType];
  return [...entry.base, ...(entry.verticals[vertical]?.fields ?? [])];
}

// ---------------------------------------------------------------------------
// Zod schema of the details
// ---------------------------------------------------------------------------

const UcpMeasure = z
  .object({
    unit: z.string().regex(/^[A-Z0-9]{2,3}$/),
    scale: z.number().int().min(0).max(15).optional(),
    display_text: z.string().min(1).max(20),
    value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

function fieldSchema(spec: FieldSpec): z.ZodType {
  switch (spec.kind) {
    case "text":
      return z.string().trim().min(1).max(spec.max);
    case "textarea":
      return z.string().trim().min(1).max(spec.max);
    case "int":
      return z.number().int().min(spec.min).max(spec.max);
    case "money":
      return z.number().int().min(0).max(100_000_000_000);
    case "bool":
      return z.boolean();
    case "enum":
      return z.enum(spec.options.map((o) => o.value) as [string, ...string[]]);
    case "list":
      return z
        .array(
          z
            .string()
            .trim()
            .min(1)
            .max(spec.each ?? 80),
        )
        .max(spec.max);
    case "multi":
      return z
        .array(
          z.enum(spec.options.map((o) => o.value) as [string, ...string[]]),
        )
        .max(spec.options.length);
    case "measure":
      return UcpMeasure.refine(
        (m) => m.unit === spec.unit,
        `Unidade esperada: ${spec.unit}.`,
      );
    case "datetime":
      return z.string().datetime({ offset: true });
    case "time":
      return z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24 horas).");
  }
}

type Tree = { [key: string]: Tree | z.ZodType };

/**
 * Strict Zod object of the details of a kind (nested by dotted keys).
 * Required fields are enforced only when `requireAll` (an active item);
 * drafts may be incomplete.
 */
export function detailsSchema(
  itemType: string,
  vertical: string,
  options: Readonly<{ requireAll?: boolean }> = {},
): z.ZodType {
  const tree: Tree = {};
  const required = new Set<string>();
  for (const spec of fieldsFor(itemType, vertical)) {
    const parts = spec.key.split(".");
    let node = tree;
    for (const part of parts.slice(0, -1)) {
      node = (node[part] ??= {}) as Tree;
    }
    node[parts.at(-1)!] = fieldSchema(spec);
    if (spec.required && options.requireAll) required.add(spec.key);
  }
  const build = (node: Tree, prefix: string): z.ZodObject =>
    z
      .object(
        Object.fromEntries(
          Object.entries(node).map(([key, value]) => {
            const path = prefix ? `${prefix}.${key}` : key;
            const schema =
              value instanceof z.ZodType ? value : build(value as Tree, path);
            return [key, required.has(path) ? schema : schema.optional()];
          }),
        ),
      )
      .strict();
  return build(tree, "");
}

// ---------------------------------------------------------------------------
// Form <-> details
// ---------------------------------------------------------------------------

export function getPath(
  details: Record<string, unknown>,
  key: string,
): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      details,
    );
}

function setPath(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const parts = key.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    node = (node[part] ??= {}) as Record<string, unknown>;
  }
  node[parts.at(-1)!] = value;
}

/** Brazilian time zone offset used for event dates typed in the form. */
const FORM_OFFSET = "-03:00";

/** Value shown in a form input for a stored detail. */
export function formValue(spec: FieldSpec, value: unknown): string {
  if (value === undefined || value === null) return "";
  switch (spec.kind) {
    case "money":
      return ((value as number) / 100).toFixed(2).replace(".", ",");
    case "measure": {
      const m = value as { value: number; scale?: number };
      return String(m.value / 10 ** (m.scale ?? 0)).replace(".", ",");
    }
    case "list":
      return (value as string[]).join("\n");
    case "datetime":
      return String(value).slice(0, 16);
    default:
      return String(value);
  }
}

/**
 * Details of a kind from a form (fields named `details.<key>`). Empty
 * inputs are left out; the schema then validates the result.
 */
export function detailsFromForm(
  itemType: string,
  vertical: string,
  formData: FormData,
): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  for (const spec of fieldsFor(itemType, vertical)) {
    const name = `details.${spec.key}`;
    if (spec.kind === "bool") {
      if (formData.get(name) === "on") setPath(details, spec.key, true);
      else if (formData.get(`${name}.present`) === "1")
        setPath(details, spec.key, false);
      continue;
    }
    if (spec.kind === "multi") {
      const values = formData.getAll(name).map(String).filter(Boolean);
      if (values.length) setPath(details, spec.key, values);
      continue;
    }
    const raw = formData.get(name);
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) continue;
    switch (spec.kind) {
      case "text":
      case "textarea":
      case "enum":
      case "time":
        setPath(details, spec.key, text);
        break;
      case "int":
        setPath(details, spec.key, Number.parseInt(text, 10));
        break;
      case "money":
        setPath(
          details,
          spec.key,
          Math.round(
            Number(text.replace(/[R$\s.]/g, "").replace(",", ".")) * 100,
          ),
        );
        break;
      case "measure":
        setPath(details, spec.key, {
          unit: spec.unit,
          display_text: spec.display_text,
          scale: spec.scale,
          value: Math.round(Number(text.replace(",", ".")) * 10 ** spec.scale),
        });
        break;
      case "list":
        // Long entries (with commas inside) go one per line.
        setPath(
          details,
          spec.key,
          text
            .split(spec.each ? /\n/ : /[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean),
        );
        break;
      case "datetime":
        setPath(
          details,
          spec.key,
          text.length === 16 ? `${text}:00${FORM_OFFSET}` : text,
        );
        break;
    }
  }
  return details;
}
