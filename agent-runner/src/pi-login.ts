import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { ModelRuntime, getAgentDir } from '@earendil-works/pi-coding-agent'
import { PI_PROVIDER, piAuthStatus } from './pi.js'

const authDir = process.env.PI_AUTH_DIR ?? getAgentDir()
if (process.argv.includes('--status')) {
  console.log(JSON.stringify(piAuthStatus(authDir), null, 2))
} else {
  await mkdir(authDir, { recursive: true, mode: 0o700 })
  const runtime = await ModelRuntime.create({
    authPath: join(authDir, 'auth.json'),
    modelsPath: null,
    refreshOnCreate: false,
  })
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  try {
    await runtime.login(PI_PROVIDER, 'oauth', {
      signal: controller.signal,
      // Browser callbacks complete automatically. Pi also supports manual input
      // and a device-code flow when the runner has no local browser.
      prompt: async (prompt) => {
        if (prompt.type === 'select')
          return process.argv.includes('--device') ? 'device_code' : 'browser'
        return input.question(`${prompt.message}\n`, {
          signal: prompt.signal ?? controller.signal,
        })
      },
      notify: (event) => {
        if (event.type === 'auth_url') {
          console.log(
            `Open this URL and sign in with your ChatGPT account:\n${event.url}`,
          )
        } else if (event.type === 'device_code') {
          console.log(
            `Open ${event.verificationUri}\nEnter this code: ${event.userCode}`,
          )
        } else {
          console.log(event.message)
        }
      },
    })
    await chmod(join(authDir, 'auth.json'), 0o600)
    console.log(
      'Pi saved your ChatGPT login. The backend can now use your subscription.',
    )
  } finally {
    input.close()
  }
}
