import { describe, expect, it } from 'vitest'

import cases from '../../../../contracts/client-cases.json'
import { getCapabilities, getModules } from './client'
const signal = new AbortController().signal
const fetcher = (body: unknown, status = 200) => (async () => Response.json(body, { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch

describe('provider-owned client behavior cases', () => {
  it.each(cases.capabilities)('$name', async ({ body, accepted }) => {
    const result = getCapabilities(signal, fetcher(body))
    await (accepted ? expect(result).resolves.toEqual(body) : expect(result).rejects.toMatchObject({ code: 'incompatible' }));
  })
  it.each(cases.modules)('$name', async ({ body, accepted }) => {
    const result = getModules(signal, fetcher(body))
    await (accepted ? expect(result).resolves.toEqual(body) : expect(result).rejects.toMatchObject({ code: 'incompatible' }));
  })
  it.each(cases.http_errors)('maps HTTP $status to $code', async ({ status, body, code }) => {
    await expect(getModules(signal, fetcher(body, status))).rejects.toMatchObject({ code })
  })
})
