import { Button } from '@/components/ui/button'
import { APP_VERSION } from '@tengyu-aipod/shared'
import { useState } from 'react'

export function App() {
  const [pingResult, setPingResult] = useState('未测试')

  const handlePing = async () => {
    const result = await window.api.ping()
    setPingResult(result)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-8 text-foreground">
      <section className="w-full max-w-xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Workbench</p>
          <h1 className="text-3xl font-semibold tracking-normal">
            腾域 aipod - Hello World - 版本 {APP_VERSION}
          </h1>
          <p className="text-base text-muted-foreground">Electron + React + Vite skeleton</p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={handlePing}>
            IPC Ping
          </Button>
          <span className="text-sm text-muted-foreground">结果：{pingResult}</span>
        </div>
      </section>
    </main>
  )
}
