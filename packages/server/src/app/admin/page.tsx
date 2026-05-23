import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function AdminHomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Admin</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">已登录</p>
        </CardContent>
      </Card>
    </main>
  )
}
