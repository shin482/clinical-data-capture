import type { Metadata, Viewport } from 'next'
import './globals.css'
import EdcWorkspace from '@/components/clinical/edc-workspace'

export const metadata: Metadata = {
  title: 'Clinical Data Capture | Local EDC',
  description: 'Local-first electronic clinical data capture workspace for hospital research teams.',
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#0e2433',
  userScalable: false,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" className="bg-background"><body className="antialiased"><EdcWorkspace />{children}</body></html>
}
