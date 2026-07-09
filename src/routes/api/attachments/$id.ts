import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import { env } from 'cloudflare:workers'

export const Route = createFileRoute('/api/attachments/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const [row] = await db
          .select()
          .from(schema.attachments)
          .where(eq(schema.attachments.id, params.id))
        if (!row) return new Response('Attachment not found', { status: 404 })

        const object = await env.ATTACHMENTS.get(row.r2Key)
        if (!object) return new Response('File not found', { status: 404 })

        const headers = new Headers()
        headers.set(
          'Content-Type',
          object.httpMetadata?.contentType ?? row.mimeType ?? 'application/octet-stream',
        )
        headers.set(
          'Content-Disposition',
          `inline; filename="${encodeURIComponent(row.name).replace(/%20/g, ' ')}"`,
        )
        if (object.size) headers.set('Content-Length', object.size.toString())

        return new Response(object.body as ReadableStream<Uint8Array>, { headers })
      },
    },
  },
})
