import { ApiClientError } from './api-client';

export type RegistrationField = 'fullName' | 'username' | 'email' | 'phone' | 'password' | 'confirm' | 'terms';
export type RegistrationFieldErrors = Partial<Record<RegistrationField, string>>;

export interface RegistrationPayload {
  fullName: string;
  username: string;
  email: string;
  phone?: string;
  password: string;
  termsAccepted: true;
}

export interface RegistrationValidationCopy {
  fullNameRequired: string;
  usernameRequired: string;
  usernameFormat: string;
  emailRequired: string;
  emailInvalid: string;
  phoneInvalid: string;
  passwordInvalid: string;
  mismatch: string;
  termsRequired: string;
  duplicateUsername: string;
  duplicateEmail: string;
  duplicate: string;
  rate: string;
  unknown: string;
}

const usernamePattern = /^[A-Za-z0-9._-]+$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strongPassword = (value: string) => value.length >= 10 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);

export function registrationSubmission(form: FormData, copy: RegistrationValidationCopy): { payload?: RegistrationPayload; errors: RegistrationFieldErrors } {
  const fullName = String(form.get('fullName') ?? '').trim();
  const username = String(form.get('username') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const phone = String(form.get('phone') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');
  const termsAccepted = form.get('terms') === 'on';
  const errors: RegistrationFieldErrors = {};

  if (fullName.length < 2 || fullName.length > 160) errors.fullName = copy.fullNameRequired;
  if (username.length < 3) errors.username = copy.usernameRequired;
  else if (username.length > 60 || !usernamePattern.test(username)) errors.username = copy.usernameFormat;
  if (!email) errors.email = copy.emailRequired;
  else if (email.length > 200 || !emailPattern.test(email)) errors.email = copy.emailInvalid;
  if (phone.length > 40) errors.phone = copy.phoneInvalid;
  if (!strongPassword(password)) errors.password = copy.passwordInvalid;
  if (password !== confirm) errors.confirm = copy.mismatch;
  if (!termsAccepted) errors.terms = copy.termsRequired;

  if (Object.keys(errors).length) return { errors };
  return { errors, payload: { fullName, username, email, ...(phone ? { phone } : {}), password, termsAccepted: true } };
}

const serverFieldErrors = (details: unknown): RegistrationFieldErrors => {
  if (!details || typeof details !== 'object' || !('fieldErrors' in details)) return {};
  const fields = (details as { fieldErrors?: unknown }).fieldErrors;
  if (!fields || typeof fields !== 'object') return {};
  const allowed: Array<[RegistrationField, string]> = [['fullName', 'fullName'], ['username', 'username'], ['email', 'email'], ['phone', 'phone'], ['password', 'password'], ['terms', 'termsAccepted']];
  return Object.fromEntries(allowed.flatMap(([field, serverField]) => {
    const value = (fields as Record<string, unknown>)[serverField];
    return Array.isArray(value) && typeof value[0] === 'string' ? [[field, value[0]]] : [];
  })) as RegistrationFieldErrors;
};

export function registrationFailure(reason: unknown, copy: RegistrationValidationCopy): { message: string; errors: RegistrationFieldErrors } {
  if (!(reason instanceof ApiClientError)) return { message: copy.unknown, errors: {} };
  if (reason.code === 'USERNAME_ALREADY_EXISTS') return { message: '', errors: { username: copy.duplicateUsername } };
  if (reason.code === 'EMAIL_ALREADY_EXISTS') return { message: '', errors: { email: copy.duplicateEmail } };
  if (reason.code === 'ACCOUNT_ALREADY_EXISTS') return { message: copy.duplicate, errors: {} };
  if (reason.code === 'REGISTRATION_RATE_LIMITED') return { message: copy.rate, errors: {} };
  if (reason.code === 'VALIDATION_ERROR') {
    const errors = serverFieldErrors(reason.details);
    return { message: Object.keys(errors).length ? '' : reason.message, errors };
  }
  return { message: copy.unknown, errors: {} };
}
