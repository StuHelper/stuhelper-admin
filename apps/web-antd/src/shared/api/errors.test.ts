import { describe, expect, it } from 'vitest';

import { ApiError, serverCode } from './errors';

describe('ApiError denial recognition (A-03)', () => {
  it('marks HTTP 401/403 and module-prefixed auth error codes as denied while preserving exact code strings', () => {
    const billingForbidden = new ApiError(
      serverCode({ code: 'billing_forbidden' }, 403),
      false,
      403,
    );
    expect(billingForbidden.code).toBe('billing_forbidden');
    expect(billingForbidden.denied).toBe(true);

    const qqUnauth = new ApiError(
      serverCode({ code: 'qq_binding_unauthenticated' }, 401),
      false,
      401,
    );
    expect(qqUnauth.code).toBe('qq_binding_unauthenticated');
    expect(qqUnauth.denied).toBe(true);

    const statusOnly = new ApiError('custom_denial', false, 403);
    expect(statusOnly.denied).toBe(true);

    const prefixedWithoutStatus = new ApiError('billing_forbidden');
    expect(prefixedWithoutStatus.denied).toBe(true);

    const conflict = new ApiError('billing_conflict', false, 409);
    expect(conflict.denied).toBe(false);
  });
});
