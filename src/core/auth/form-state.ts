/** Shape returned by the identity Server Actions to their client forms. */
export type AuthFormState = Readonly<{
  error?: string;
  message?: string;
}>;

export const EMPTY_FORM_STATE: AuthFormState = {};

/**
 * Messages shown to visitors. They are deliberately vague about whether an
 * e-mail exists or which half of the credentials failed (specification
 * section 15: never reveal another account's existence).
 */
export const AUTH_MESSAGES = {
  invalidCredentials: "E-mail ou senha inválidos.",
  invalidInput: "Confira os dados informados.",
  unavailable: "Serviço de identidade indisponível. Tente novamente.",
  recoverySent:
    "Se existir uma conta com esse e-mail, enviamos um link de recuperação.",
  passwordUpdated: "Senha atualizada. Você já pode entrar.",
  recoveryLinkInvalid:
    "O link de recuperação é inválido ou expirou. Peça um novo.",
  invalidMfaCode: "Código inválido ou expirado.",
  weakPassword: "Use uma senha com pelo menos 12 caracteres.",
} as const;
