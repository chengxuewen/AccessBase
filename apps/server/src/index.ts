import { buildApp } from './app.js'
import { config } from './config.js'

async function main() {
  const app = await buildApp()

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Received shutdown signal, closing server...')
    try {
      await app.close()
      app.log.info('Server closed gracefully')
      process.exit(0)
    } catch (err) {
      app.log.error(err, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  try {
    await app.listen({ port: config.port, host: config.host })
    app.log.info(`Server listening on ${config.host}:${config.port}`)
  } catch (err) {
    app.log.fatal(err, 'Failed to start server')
    process.exit(1)
  }
}

main()
