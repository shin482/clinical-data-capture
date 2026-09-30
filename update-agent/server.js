const { createUpdateAgent } = require('./app')
const { loadConfig } = require('./config')

function start() {
  let config
  try {
    config = loadConfig()
  } catch (error) {
    console.error(`Update Agent configuration error: ${error.message}`)
    process.exitCode = 1
    return
  }

  const server = createUpdateAgent(config)
  server.on('error', (error) => {
    console.error(`Update Agent failed: ${error.message}`)
    process.exitCode = 1
  })
  server.listen(config.agentPort, config.host, () => {
    console.log(`Update Agent listening on http://${config.host}:${config.agentPort}`)
  })
}

if (require.main === module) start()

module.exports = { start }
