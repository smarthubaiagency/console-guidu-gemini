import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

/**
 * Validator of the official UCP JSON Schemas copied to
 * tests/fixtures/ucp/schemas (commit in its README). Every schema is added
 * by its `$id`, so relative `$ref`s resolve as in the protocol.
 */
const ROOT = fileURLToPath(
  new URL("../../fixtures/ucp/schemas", import.meta.url),
);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? files(path)
      : path.endsWith(".json")
        ? [path]
        : [];
  });
}

let ajv: Ajv2020 | null = null;

function instance(): Ajv2020 {
  if (ajv) return ajv;
  ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const file of files(ROOT)) {
    ajv.addSchema(JSON.parse(readFileSync(file, "utf8")));
  }
  return ajv;
}

export function ucpValidator(path: string): ValidateFunction {
  const validate = instance().getSchema(`https://ucp.dev/schemas/${path}`);
  if (!validate) throw new Error(`UCP schema not found: ${path}`);
  return validate;
}

/** Errors of a value against a UCP schema, as readable lines (empty = valid). */
export function ucpErrors(path: string, value: unknown): string[] {
  const validate = ucpValidator(path);
  return validate(value)
    ? []
    : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}
