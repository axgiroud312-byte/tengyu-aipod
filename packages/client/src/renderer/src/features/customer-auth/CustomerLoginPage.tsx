import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { Loader2, LogOut, QrCode, RefreshCcw, ShieldCheck, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CustomerAuthQrcode,
  CustomerAuthState,
  CustomerAuthStatus,
} from '../../../../main/lib/customer-auth'

type CustomerLoginPageProps = {
  checking: boolean
  onRetryVerify: () => Promise<void>
  onStateChange: (state: CustomerAuthState) => void
  state: CustomerAuthState
}

const STATUS_TEXT: Record<CustomerAuthStatus, { label: string; message: string }> = {
  active: { label: '已授权', message: '账号已授权，可以进入工作台。' },
  anonymous: { label: '未登录', message: '请使用微信扫码或手机号验证码登录。' },
  disabled: { label: '已禁用', message: '账号已被后台禁用。' },
  expired: { label: '已到期', message: '账号授权已到期。' },
  nologin: { label: '登录失效', message: '登录状态已失效，请重新登录。' },
  pending: { label: '待授权', message: '账号已登录，等待管理员后台授权。' },
}

function statusClassName(status: CustomerAuthStatus) {
  return cn(
    'rounded-sm border p-4 text-sm leading-6 text-pretty',
    status === 'active' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
    status === 'pending' && 'border-amber-200 bg-amber-50 text-amber-800',
    status === 'expired' && 'border-orange-200 bg-orange-50 text-orange-800',
    status === 'disabled' && 'border-red-200 bg-red-50 text-red-800',
    status === 'nologin' && 'border-red-200 bg-red-50 text-red-800',
    status === 'anonymous' && 'border-border bg-muted/30 text-muted-foreground',
  )
}

function isBlockedStatus(status: CustomerAuthStatus) {
  return status === 'pending' || status === 'disabled' || status === 'expired'
}

function authDisplayName(state: CustomerAuthState) {
  return (
    state.customer?.nickname ||
    state.customer?.account ||
    state.customer?.phone ||
    (state.customer?.php_uid ? `UID ${state.customer.php_uid}` : null)
  )
}

export function CustomerLoginPage({
  checking,
  onRetryVerify,
  onStateChange,
  state,
}: CustomerLoginPageProps) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [invite, setInvite] = useState('')
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null)
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [smsRemaining, setSmsRemaining] = useState(0)
  const [qrcode, setQrcode] = useState<CustomerAuthQrcode | null>(null)
  const [wechatMessage, setWechatMessage] = useState<string | null>(null)
  const [wechatBusy, setWechatBusy] = useState(false)
  const [polling, setPolling] = useState(false)
  const pollingRef = useRef(false)
  const authName = authDisplayName(state)
  const statusMeta = STATUS_TEXT[state.status]

  useEffect(() => {
    let active = true
    window.api.customerAuth
      .getSmsCountdown()
      .then((result) => {
        if (active) {
          setSmsRemaining(result.remaining_seconds)
        }
      })
      .catch(() => null)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (smsRemaining <= 0) {
      return
    }

    const timer = window.setInterval(() => {
      setSmsRemaining((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [smsRemaining])

  const applyLoginState = useCallback(
    (nextState: CustomerAuthState) => {
      onStateChange(nextState)
      if (nextState.status !== 'anonymous') {
        setPolling(false)
      }
    },
    [onStateChange],
  )

  const checkWechatOnce = useCallback(async () => {
    if (!qrcode?.token || pollingRef.current) {
      return
    }

    pollingRef.current = true
    try {
      const nextState = await window.api.customerAuth.checkWechatLogin({ token: qrcode.token })
      setWechatMessage(nextState.message ?? STATUS_TEXT[nextState.status].message)
      applyLoginState(nextState)
    } catch (error) {
      setWechatMessage(error instanceof Error ? error.message : '微信登录状态查询失败')
    } finally {
      pollingRef.current = false
    }
  }, [applyLoginState, qrcode?.token])

  useEffect(() => {
    if (!polling || !qrcode?.token) {
      return
    }

    const timer = window.setInterval(() => {
      void checkWechatOnce()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [checkWechatOnce, polling, qrcode?.token])

  async function handleGetQrcode() {
    setWechatBusy(true)
    setWechatMessage(null)
    setPolling(false)
    try {
      const nextQrcode = await window.api.customerAuth.getQrcode()
      setQrcode(nextQrcode)
      setPolling(true)
      setWechatMessage('二维码已生成，等待扫码确认。')
    } catch (error) {
      setQrcode(null)
      setWechatMessage(error instanceof Error ? error.message : '二维码获取失败')
    } finally {
      setWechatBusy(false)
    }
  }

  async function handleSendSms() {
    setPhoneBusy(true)
    setPhoneMessage(null)
    try {
      const result = await window.api.customerAuth.sendSms({ phone })
      setSmsRemaining(result.remaining_seconds)
      setPhoneMessage(result.message)
    } catch (error) {
      setPhoneMessage(error instanceof Error ? error.message : '验证码发送失败')
    } finally {
      setPhoneBusy(false)
    }
  }

  async function handlePhoneLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPhoneBusy(true)
    setPhoneMessage(null)
    try {
      const nextState = await window.api.customerAuth.loginByPhone({ code, invite, phone })
      setPhoneMessage(nextState.message ?? STATUS_TEXT[nextState.status].message)
      applyLoginState(nextState)
    } catch (error) {
      setPhoneMessage(error instanceof Error ? error.message : '手机号登录失败')
    } finally {
      setPhoneBusy(false)
    }
  }

  async function handleLogout() {
    const nextState = await window.api.customerAuth.logout()
    setQrcode(null)
    setPolling(false)
    setPhoneMessage(null)
    setWechatMessage(null)
    onStateChange(nextState)
  }

  return (
    <main className="min-h-dvh bg-background px-6 py-8 text-foreground">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <section className="flex flex-col justify-between rounded-md border bg-muted/20 p-6">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-sm bg-primary text-primary-foreground">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-balance">腾域 aipod</h1>
                <p className="text-sm text-muted-foreground text-pretty">客户登录与后台授权</p>
              </div>
            </div>

            <div className={statusClassName(state.status)}>
              <div className="mb-2 flex items-center gap-2">
                <Badge variant={isBlockedStatus(state.status) ? 'outline' : 'secondary'}>
                  {statusMeta.label}
                </Badge>
                {checking ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <Loader2 className="size-3.5 animate-spin" />
                    校验中
                  </span>
                ) : null}
              </div>
              <p>{state.message ?? statusMeta.message}</p>
              {authName ? <p className="mt-2 text-xs tabular-nums">当前账号：{authName}</p> : null}
              {state.customer?.expires_at ? (
                <p className="text-xs tabular-nums">到期时间：{state.customer.expires_at}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            <Button disabled={checking} onClick={() => void onRetryVerify()} variant="outline">
              <RefreshCcw className="mr-2 size-4" />
              重新校验
            </Button>
            {state.status !== 'anonymous' ? (
              <Button onClick={() => void handleLogout()} variant="ghost">
                <LogOut className="mr-2 size-4" />
                退出登录
              </Button>
            ) : null}
          </div>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>登录</CardTitle>
            <CardDescription>使用旧官网账号登录，后台授权后进入工作台。</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs className="w-full" defaultValue="wechat">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="wechat">
                  <QrCode className="mr-2 size-4" />
                  微信扫码
                </TabsTrigger>
                <TabsTrigger value="phone">
                  <Smartphone className="mr-2 size-4" />
                  手机号
                </TabsTrigger>
              </TabsList>

              <TabsContent className="space-y-4 pt-4" value="wechat">
                <div className="grid gap-4 md:grid-cols-[240px_1fr]">
                  <div className="grid aspect-square w-full max-w-60 place-items-center rounded-md border bg-muted/20 p-3">
                    {qrcode ? (
                      <img
                        alt="微信登录二维码"
                        className="size-full object-contain"
                        src={qrcode.qrcode_image_url}
                      />
                    ) : (
                      <QrCode className="size-16 text-muted-foreground" />
                    )}
                  </div>
                  <div className="space-y-3">
                    <Button disabled={wechatBusy} onClick={() => void handleGetQrcode()}>
                      {wechatBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                      获取二维码
                    </Button>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={!qrcode?.token}
                        onClick={() => void checkWechatOnce()}
                        variant="outline"
                      >
                        手动查询
                      </Button>
                      <Button disabled={!polling} onClick={() => setPolling(false)} variant="ghost">
                        停止轮询
                      </Button>
                    </div>
                    {qrcode?.token ? (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        token：{qrcode.token}
                      </p>
                    ) : null}
                    {qrcode?.qrcode_url ? (
                      <a
                        className="text-sm text-primary underline-offset-4 hover:underline"
                        href={qrcode.qrcode_url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        打开授权链接
                      </a>
                    ) : null}
                    <p className="min-h-6 text-sm text-muted-foreground text-pretty">
                      {wechatMessage ?? (polling ? '正在等待扫码确认。' : '等待获取二维码。')}
                    </p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent className="pt-4" value="phone">
                <form className="space-y-4" onSubmit={(event) => void handlePhoneLogin(event)}>
                  <div className="grid gap-4 md:grid-cols-[1fr_160px]">
                    <label className="space-y-2" htmlFor="customer-phone">
                      <span className="text-sm font-medium">手机号</span>
                      <Input
                        autoComplete="tel"
                        id="customer-phone"
                        inputMode="tel"
                        onChange={(event) => setPhone(event.target.value)}
                        placeholder="请输入手机号"
                        value={phone}
                      />
                    </label>
                    <div className="flex items-end">
                      <Button
                        className="w-full"
                        disabled={phoneBusy || smsRemaining > 0}
                        onClick={() => void handleSendSms()}
                        type="button"
                        variant="outline"
                      >
                        {phoneBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                        {smsRemaining > 0 ? `${smsRemaining}s` : '发送验证码'}
                      </Button>
                    </div>
                  </div>

                  <label className="space-y-2" htmlFor="customer-code">
                    <span className="text-sm font-medium">验证码</span>
                    <Input
                      autoComplete="one-time-code"
                      id="customer-code"
                      inputMode="numeric"
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="请输入验证码"
                      value={code}
                    />
                  </label>

                  <label className="space-y-2" htmlFor="customer-invite">
                    <span className="text-sm font-medium">邀请码</span>
                    <Input
                      id="customer-invite"
                      onChange={(event) => setInvite(event.target.value)}
                      placeholder="可选"
                      value={invite}
                    />
                  </label>

                  <Button disabled={phoneBusy} type="submit">
                    {phoneBusy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    验证码登录
                  </Button>

                  <p className="min-h-6 text-sm text-muted-foreground text-pretty">
                    {phoneMessage ?? '等待输入验证码。'}
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
