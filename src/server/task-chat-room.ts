import { DurableObject } from 'cloudflare:workers'

export class TaskChatRoom extends DurableObject {
  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    if (request.method === 'POST') {
      const payload = await request.text()
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(payload)
        } catch {}
      }
      return Response.json({ ok: true })
    }

    return new Response('Not found', { status: 404 })
  }
}
