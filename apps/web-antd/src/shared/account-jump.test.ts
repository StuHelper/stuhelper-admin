import { describe, expect, it } from 'vitest';

import {
  createAccountJumpStore,
  encodePrincipalKey,
  fromIssuerSubject,
  parseAccountIdentifier,
} from './account-jump';

describe('account-jump', () => {
  it('encodes and decodes Principal.Key() and issuer|subject identifiers', () => {
    const key = encodePrincipalKey('https://id.example.invalid', 'user-1');
    expect(key).toBe('aHR0cHM6Ly9pZC5leGFtcGxlLmludmFsaWQ:dXNlci0x');

    expect(parseAccountIdentifier(key)).toEqual({
      issuer: 'https://id.example.invalid',
      principalKey: key,
      raw: key,
      subject: 'user-1',
    });

    expect(parseAccountIdentifier('https://id.example.invalid|user-1')).toEqual(
      {
        issuer: 'https://id.example.invalid',
        principalKey: key,
        raw: 'https://id.example.invalid|user-1',
        subject: 'user-1',
      },
    );

    expect(parseAccountIdentifier('admin-1')).toEqual({
      issuer: '',
      principalKey: 'admin-1',
      raw: 'admin-1',
      subject: 'admin-1',
    });
  });

  it('consumes one-time targets by destination and clears session state', () => {
    const store = createAccountJumpStore();
    const target = fromIssuerSubject('https://id.example.invalid', 'user-7');
    store.prepare('billing', target);
    store.rememberIssuer('https://id.example.invalid');

    expect(store.consume('roles')).toBeUndefined();
    expect(store.consume('billing')).toEqual(target);
    expect(store.consume('billing')).toBeUndefined();
    expect(store.recentIssuer.value).toBe('https://id.example.invalid');

    store.prepare('sessions', target);
    store.clear();
    expect(store.consume('sessions')).toBeUndefined();
    expect(store.recentIssuer.value).toBe('');
  });
});
