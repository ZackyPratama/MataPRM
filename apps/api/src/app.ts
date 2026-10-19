import Fastify from 'fastify'
import { sharedMessage } from '@mataprm/shared'

export function buildApp() {
  const app = Fastify()

  app.get('/', async () => ({ status: sharedMessage() }))

  return app
}
