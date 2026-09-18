import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'

export async function GET() {
  const guidePath = path.join(
    process.cwd(),
    'public',
    'guide',
    'EDC_사용자_가이드라인_인포그래픽.html',
  )
  const html = await readFile(guidePath)

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  })
}
