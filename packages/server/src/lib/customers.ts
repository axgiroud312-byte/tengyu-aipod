import type { Customer } from '@prisma/client'

export type CustomerListItem = {
  id: string
  name: string
  phone: string
  email: string | null
  wechat: string | null
  notes: string | null
  is_active: boolean
  status: 'active' | 'banned'
  created_at: string
}

export type CustomerDetailItem = CustomerListItem

export function buildCustomerSummary(customer: Customer): CustomerListItem {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    wechat: customer.wechat,
    notes: customer.notes,
    is_active: customer.is_active,
    status: customer.is_active ? 'active' : 'banned',
    created_at: customer.created_at.toISOString(),
  }
}

export function serializeCustomer(customer: Customer): CustomerDetailItem {
  return buildCustomerSummary(customer)
}
