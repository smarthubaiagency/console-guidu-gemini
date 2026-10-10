import { AppError } from "@/shared/errors";

export function partnerNotFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Parceiro não encontrado.",
  });
}

export function invalidPartnerInput(message: string): AppError {
  return new AppError({ code: "invalid_input", safeMessage: message });
}
