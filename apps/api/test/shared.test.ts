import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

const app = buildApp()

afterAll(async () => app.close())

describe('api workspace', () => {
  it('uses shared package', async () => {
    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.json()).toEqual({ status: 'shared-ready' })
  })
})
