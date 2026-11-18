import { inject, type InjectionKey, readonly, ref, shallowRef } from 'vue';

export type AccountJumpDestination =
  | 'billing'
  | 'qqBinding'
  | 'roles'
  | 'sessions';

export interface AccountTarget {
  issuer: string;
  principalKey: string;
  raw: string;
  subject: string;
}

function encodeBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeBase64Url(encoded: string): string | undefined {
  if (!encoded || !/^[\w-]+$/u.test(encoded)) return undefined;
  const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const pad = (4 - (normalized.length % 4)) % 4;
  try {
    const binary = atob(normalized + '='.repeat(pad));
    const bytes = Uint8Array.from(binary, (ch) => ch.codePointAt(0) ?? 0);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Encode an OIDC (issuer, subject) pair into Go's `Principal.Key()` format. */
export function encodePrincipalKey(issuer: string, subject: string): string {
  const cleanIssuer = issuer.trim();
  const cleanSubject = subject.trim();
  if (!cleanIssuer) return cleanSubject;
  if (!cleanSubject) return '';
  return `${encodeBase64Url(cleanIssuer)}:${encodeBase64Url(cleanSubject)}`;
}

export function fromIssuerSubject(
  issuer: string,
  subject: string,
): AccountTarget {
  const cleanIssuer = issuer.trim();
  const cleanSubject = subject.trim();
  const principalKey =
    cleanIssuer && cleanSubject
      ? encodePrincipalKey(cleanIssuer, cleanSubject)
      : cleanSubject;
  return {
    issuer: cleanIssuer,
    principalKey,
    raw: cleanIssuer ? `${cleanIssuer}|${cleanSubject}` : cleanSubject,
    subject: cleanSubject,
  };
}

/**
 * Parse an account string from information-query (`issuer|subject`) or audit /
 * binding (`base64url(issuer):base64url(subject)` or bare subject).
 */
export function parseAccountIdentifier(value: string): AccountTarget {
  const raw = value.trim();
  if (!raw) return { issuer: '', principalKey: '', raw: '', subject: '' };
  const pipe = raw.indexOf('|');
  if (pipe > 0 && pipe < raw.length - 1) {
    const issuer = raw.slice(0, pipe).trim();
    const subject = raw.slice(pipe + 1).trim();
    return {
      issuer,
      principalKey:
        issuer && subject ? encodePrincipalKey(issuer, subject) : raw,
      raw,
      subject,
    };
  }
  const colon = raw.indexOf(':');
  if (
    colon > 0 &&
    colon === raw.lastIndexOf(':') &&
    /^[\w-]+:[\w-]+$/u.test(raw)
  ) {
    const issuer = decodeBase64Url(raw.slice(0, colon));
    const subject = decodeBase64Url(raw.slice(colon + 1));
    if (issuer && /^https?:\/\//u.test(issuer) && subject) {
      return { issuer, principalKey: raw, raw, subject };
    }
  }
  return { issuer: '', principalKey: raw, raw, subject: raw };
}

export function createAccountJumpStore() {
  const pending = shallowRef<{
    destination: AccountJumpDestination;
    target: AccountTarget;
  }>();
  const recentIssuer = ref('');

  function prepare(
    destination: AccountJumpDestination,
    target: AccountTarget,
  ) {
    const request = { destination, target };
    pending.value = request;
    return () => {
      if (pending.value === request) pending.value = undefined;
    };
  }

  function consume(
    destination: AccountJumpDestination,
  ): AccountTarget | undefined {
    if (pending.value?.destination !== destination) return undefined;
    const target = pending.value.target;
    pending.value = undefined;
    return target;
  }

  function rememberIssuer(issuer: string) {
    const clean = issuer.trim();
    if (clean) recentIssuer.value = clean;
  }

  function clear() {
    pending.value = undefined;
    recentIssuer.value = '';
  }

  return {
    clear,
    consume,
    pending: readonly(pending),
    prepare,
    recentIssuer: readonly(recentIssuer),
    rememberIssuer,
  };
}

export type AccountJumpStore = ReturnType<typeof createAccountJumpStore>;
export const accountJumpKey: InjectionKey<AccountJumpStore> =
  Symbol('stuhelper-account-jump');

export function useAccountJump(): AccountJumpStore {
  return inject(accountJumpKey, () => createAccountJumpStore(), true);
}
