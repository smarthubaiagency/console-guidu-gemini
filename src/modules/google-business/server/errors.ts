import { AppError } from "@/shared/errors";

/** Errors of the module (GB1a); texts by key in the three languages. */

export function gbNotFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Recurso não encontrado.",
    messageKey: "googleBusiness.errors.notFound",
  });
}

export function gbForbidden(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage: "Você não pode alterar esta ficha.",
    messageKey: "googleBusiness.errors.forbidden",
  });
}

export function gbConflict(message: string, key: string): AppError {
  return new AppError({
    code: "conflict",
    safeMessage: message,
    messageKey: `googleBusiness.errors.${key}`,
  });
}
