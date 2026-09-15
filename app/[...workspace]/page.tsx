import { notFound } from 'next/navigation'
import { workspaceRoutes } from '@/lib/workspace-routes'

export default async function WorkspacePage({ params }: { params: Promise<{ workspace: string[] }> }) {
  const { workspace } = await params
  const pathname = '/' + workspace.join('/')
  if (!Object.values(workspaceRoutes).includes(pathname)) notFound()
  return null
}
