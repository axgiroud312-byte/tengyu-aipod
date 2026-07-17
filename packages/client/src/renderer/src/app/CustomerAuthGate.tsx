import { CustomerLoginPage } from '@/features/customer-auth/CustomerLoginPage'
import { Loader2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import type { CustomerAuthState } from '../../../main/lib/customer-auth'

const CUSTOMER_AUTH_RECHECK_MS = 5 * 60 * 1000
const CUSTOMER_AUTH_PENDING_RECHECK_MS = 3 * 1000

const anonymousCustomerAuthState: CustomerAuthState = {
  customer: null,
  message: null,
  status: 'anonymous',
}

function EnteringWorkbench() {
  return (
    <main className="grid min-h-screen place-items-center bg-background text-foreground">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        正在进入工作台...
      </div>
    </main>
  )
}

export function CustomerAuthGate({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<CustomerAuthState>(anonymousCustomerAuthState)
  const [checking, setChecking] = useState(true)
  const [initialChecked, setInitialChecked] = useState(false)

  const verifyAuth = useCallback(async () => {
    setChecking(true)
    try {
      const nextState = await window.api.customerAuth.verify()
      setAuthState(nextState)
    } catch (error) {
      setAuthState({
        customer: null,
        message: error instanceof Error ? error.message : '客户授权校验失败',
        status: 'anonymous',
      })
    } finally {
      setChecking(false)
      setInitialChecked(true)
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadAuthState() {
      try {
        const snapshot = await window.api.customerAuth.getState()
        if (active) {
          setAuthState(snapshot)
        }
      } catch {
        // First render still performs the required strong verification below.
      }

      if (active) {
        await verifyAuth()
      }
    }

    void loadAuthState()
    return () => {
      active = false
    }
  }, [verifyAuth])

  useEffect(() => {
    if (authState.status !== 'active') {
      return
    }

    const timer = window.setInterval(() => {
      void window.api.customerAuth
        .verify({ allowStaleOnTransientFailure: true })
        .then(setAuthState)
        .catch((error) => {
          setAuthState({
            customer: null,
            message: error instanceof Error ? error.message : '客户授权校验失败',
            status: 'anonymous',
          })
        })
    }, CUSTOMER_AUTH_RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [authState.status])

  useEffect(() => {
    if (!initialChecked || authState.status !== 'pending') {
      return
    }

    let inFlight = false
    const verifyPending = () => {
      if (inFlight) {
        return
      }
      inFlight = true
      void window.api.customerAuth
        .verify()
        .then((nextState) => {
          setAuthState((current) =>
            current.status === 'pending' && nextState.status === 'anonymous'
              ? {
                  ...current,
                  message: nextState.message ?? '客户授权校验失败',
                }
              : nextState,
          )
        })
        .catch((error) => {
          setAuthState((current) =>
            current.status === 'pending'
              ? {
                  ...current,
                  message: error instanceof Error ? error.message : '客户授权校验失败',
                }
              : current,
          )
        })
        .finally(() => {
          inFlight = false
        })
    }

    const timer = window.setInterval(verifyPending, CUSTOMER_AUTH_PENDING_RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [authState.status, initialChecked])

  if (!initialChecked && authState.status === 'active') {
    return <EnteringWorkbench />
  }

  if (!initialChecked || authState.status !== 'active') {
    return (
      <CustomerLoginPage
        checking={checking}
        onRetryVerify={verifyAuth}
        onStateChange={setAuthState}
        state={authState}
      />
    )
  }

  return <>{children}</>
}
