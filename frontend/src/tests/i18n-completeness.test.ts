import { describe, expect, it } from 'vitest';
import { messages } from '@/i18n/i18n';
import { homeContent } from '@/i18n/home-content';
import { loginContent } from '@/i18n/login-content';

const shape = (value: unknown): unknown => Array.isArray(value)
  ? value.map(shape)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shape(child)]))
    : typeof value;

describe('i18n dictionaries', () => {
  it.each([messages, homeContent, loginContent])('keeps identical key and array structure for every locale', (dictionary) => {
    expect(shape(dictionary.en)).toEqual(shape(dictionary.th));
    expect(shape(dictionary['zh-CN'])).toEqual(shape(dictionary.th));
  });
});
