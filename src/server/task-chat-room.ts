import { DurableObject } from 'cloudflare:workers'

export class TaskChatRoom extends DurableObject {
  private sockets = new Set<WebSocket>()

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
  }

  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.ctx.acceptWebSocket(server)
      this.sockets.add(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    if (request.method === 'POST') {
      const payload = await request.text()
      for (const socket of this.sockets) {
        try {
          socket.send(payload)
        } catch {
          this.sockets.delete(socket)
        }
      }
      return Response.json({ ok: true })
    }

    return new Response('Not found', { status: 404 })
  }

  webSocketClose(socket: WebSocket) {
    this.sockets.delete(socket)
  }

  webSocketError(socket: WebSocket) {
    this.sockets.delete(socket)
  }
}
