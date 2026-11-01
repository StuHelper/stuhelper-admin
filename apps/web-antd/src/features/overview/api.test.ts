import { describe, expect, it } from 'vitest'

import { Http } from '#/shared/api/http'

import cases from '../../../../../contracts/client-cases.json'
import { getCapabilities, getModules } from './api'

const http = (body: unknown, status = 200) => new Http((async () => Response.json(body, { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch)

describe('provider-owned platform client cases', () => {
  it.each(cases.capabilities)('$name', async ({ body, accepted }) => {
    const result = getCapabilities(http(body))
    await (accepted ? expect(result).resolves.toEqual(body) : expect(result).rejects.toMatchObject({ code: 'incompatible' }));
  })
  it.each(cases.modules)('$name', async ({ body, accepted }) => {
    const result = getModules(http(body))
    await (accepted ? expect(result).resolves.toEqual(body) : expect(result).rejects.toMatchObject({ code: 'incompatible' }));
  })
  it.each(cases.http_errors)('maps HTTP $status to $code', async ({ status, body, code }) => {
    await expect(getModules(http(body, status))).rejects.toMatchObject({ code })
  })
})
