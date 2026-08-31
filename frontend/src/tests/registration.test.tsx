import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiClientError } from '@/lib/api-client';
import { registrationFailure, registrationSubmission } from '@/lib/registration-contract';
import { messages } from '@/i18n/i18n';
import RegisterPage from '@/pages/RegisterPage';
import { renderWithProviders } from './test-utils';

const copy = messages.th.validation;
const validForm = () => {
  const form = new FormData();
  form.set('fullName', 'Public Test User');
  form.set('username', 'public_signup_test');
  form.set('email', 'public-signup-test@example.com');
  form.set('phone', '0812345678');
  form.set('password', 'Strong!Pass123');
  form.set('confirm', 'Strong!Pass123');
  form.set('terms', 'on');
  return form;
};

const jsonResponse = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

const fillValidPage = () => {
  fireEvent.change(screen.getByLabelText('ชื่อ-นามสกุล'), { target: { value: 'Public Test User' } });
  fireEvent.change(screen.getByLabelText(/ชื่อผู้ใช้/), { target: { value: 'public_signup_test' } });
  fireEvent.change(screen.getByLabelText('อีเมล'), { target: { value: 'public-signup-test@example.com' } });
  fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'Strong!Pass123' } });
  fireEvent.change(screen.getByLabelText('ยืนยันรหัสผ่าน'), { target: { value: 'Strong!Pass123' } });
  fireEvent.click(screen.getByRole('checkbox'));
};

afterEach(() => vi.unstubAllGlobals());

describe('registration contract', () => {
  it('builds the exact backend payload and excludes confirmPassword/UI fields', () => {
    const result = registrationSubmission(validForm(), copy);
    expect(result.errors).toEqual({});
    expect(result.payload).toEqual({ fullName: 'Public Test User', username: 'public_signup_test', email: 'public-signup-test@example.com', phone: '0812345678', password: 'Strong!Pass123', termsAccepted: true });
    expect(result.payload).not.toHaveProperty('confirm');
    expect(result.payload).not.toHaveProperty('confirmPassword');
  });

  it('returns client field errors for username, email, password, confirmation, and terms', () => {
    const form = validForm();
    form.set('username', 'ผู้ใช้ทดสอบ'); form.set('email', 'bad'); form.set('password', 'weak'); form.set('confirm', 'other'); form.delete('terms');
    expect(registrationSubmission(form, copy).errors).toMatchObject({ username: copy.usernameFormat, email: copy.emailInvalid, password: copy.passwordInvalid, confirm: copy.mismatch, terms: copy.termsRequired });
  });

  it('maps backend conflicts, validation details, and unknown failures safely', () => {
    expect(registrationFailure(new ApiClientError('USERNAME_ALREADY_EXISTS', 'server', 409), copy).errors.username).toBe(copy.duplicateUsername);
    expect(registrationFailure(new ApiClientError('EMAIL_ALREADY_EXISTS', 'server', 409), copy).errors.email).toBe(copy.duplicateEmail);
    expect(registrationFailure(new ApiClientError('VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง', 400, { fieldErrors: { username: ['safe server message'] } }), copy).errors.username).toBe('safe server message');
    expect(registrationFailure(new Error('network'), copy).message).toBe('ไม่สามารถลงทะเบียนได้ กรุณาลองใหม่อีกครั้ง');
  });
});

describe('registration page', () => {
  it('shows field errors without sending an invalid form', () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<RegisterPage />, { route: '/register' });
    fireEvent.click(screen.getByRole('button', { name: /สร้างบัญชี/ }));
    expect(screen.getByText(copy.usernameRequired)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits once, disables while loading, and shows pending approval success', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<RegisterPage />, { route: '/register' });
    fillValidPage();
    const submit = screen.getByRole('button', { name: /สร้างบัญชี/ });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(await screen.findByRole('button', { name: /กำลังสร้างบัญชี/ })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(sent).not.toHaveProperty('confirm');
    resolveFetch?.(await jsonResponse({ success: true, data: { status: 'PENDING_WORKSPACE' }, message: 'สร้างบัญชีสำเร็จ' }));
    expect(await screen.findByRole('heading', { name: 'สร้างบัญชีสำเร็จ' })).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่มีสิทธิ์ในบริษัทใด/)).toBeInTheDocument();
  });

  it('shows backend duplicate username and unknown failure messages', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse({ success: false, error: { code: 'USERNAME_ALREADY_EXISTS', message: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' } }, 409))
      .mockImplementationOnce(() => jsonResponse({ success: false, error: { code: 'INTERNAL_ERROR', message: 'internal' } }, 500));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<RegisterPage />, { route: '/register' }); fillValidPage();
    fireEvent.click(screen.getByRole('button', { name: /สร้างบัญชี/ }));
    expect(await screen.findByText(copy.duplicateUsername)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /สร้างบัญชี/ }));
    await waitFor(() => expect(screen.getByText(copy.unknown)).toBeInTheDocument());
  });
});
