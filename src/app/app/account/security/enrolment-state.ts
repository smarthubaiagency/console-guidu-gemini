/**
 * State exchanged between the enrolment form and its Server Actions. It lives
 * outside `actions.ts` because a `"use server"` module may only export async
 * functions.
 */
export type EnrolmentState = Readonly<{
  factorId?: string;
  /** `otpauth://` URI, for manual entry in the authenticator app. */
  uri?: string;
  /** Shared secret, shown once so the user can type it by hand. */
  secret?: string;
  error?: string;
  code?: string;
  requestId?: string;
  message?: string;
}>;

export const EMPTY_ENROLMENT: EnrolmentState = {};
