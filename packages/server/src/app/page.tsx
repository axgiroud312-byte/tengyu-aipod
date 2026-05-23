import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>腾域 aipod 服务端</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Next.js + Prisma skeleton</p>
        </CardContent>
      </Card>
    </main>
  )
}
