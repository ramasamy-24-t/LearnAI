export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const env = {
    node: process.version,
    has_DATABASE_URL: Boolean(process.env.DATABASE_URL),
    has_AUTH_SECRET: Boolean(process.env.AUTH_SECRET),
    has_AZURE_OPENAI_API_KEY: Boolean(process.env.AZURE_OPENAI_API_KEY),
  }

  let db
  try {
    const { prisma } = await import('../../../lib/prisma')
    const boards = await prisma.board.count()
    db = { ok: true, boards }
  } catch (e) {
    db = { ok: false, error: String(e?.message || e).slice(0, 800) }
  }

  return Response.json({ env, db })
}
