import { buildApp } from './app.js'

const app = buildApp()

const shutdown = async () => {
  try {
    await app.close()
  } catch {
    console.error('Gagal menutup server.')
    process.exitCode = 1
  }
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

try {
  await app.listen({ host: '0.0.0.0', port: 3000 })
} catch {
  console.error('Gagal menjalankan server.')
  process.exitCode = 1
  await shutdown()
}
