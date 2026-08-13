import { getProvider } from '../src/agents/llmProvider.js'
import type { ChatMessage } from '../src/agents/types.js'

async function main() {
  const provider = getProvider({ kind: 'demo' })
  const messages: ChatMessage[] = [
    { role: 'user', content: '帮我想一个 SaaS 产品的社媒投放策略' }
  ]
  let streamed = ''
  console.log('provider.name =', provider.name)
  const full = await provider.chat(messages, {
    onDelta: (d) => {
      streamed += d
    }
  })
  console.log('--- streamed length:', streamed.length)
  console.log('--- returned length:', full.length)
  console.log('--- match:', streamed === full)
  console.log('--- preview ---')
  console.log(full.slice(0, 240))
}

main()
