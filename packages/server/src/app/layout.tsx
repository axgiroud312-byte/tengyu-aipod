import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '腾域 aipod 服务端',
  description: '腾域 aipod Server',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
