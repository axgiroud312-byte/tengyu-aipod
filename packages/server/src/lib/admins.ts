import { db } from '@/lib/db'
import type { Admin } from '@prisma/client'
import bcrypt from 'bcrypt'

const BCRYPT_COST = 12

export type SerializedAdmin = {
  created_at: string
  email: string
  id: string
  is_active: boolean
  last_login_at: string | null
  name: string
  role: string
}

function iso(value: Date | null) {
  return value ? value.toISOString() : null
}

export function serializeAdmin(admin: Admin): SerializedAdmin {
  return {
    created_at: admin.created_at.toISOString(),
    email: admin.email,
    id: admin.id,
    is_active: admin.is_active,
    last_login_at: iso(admin.last_login_at),
    name: admin.name,
    role: admin.role,
  }
}

export async function listAdmins() {
  const admins = await db.admin.findMany({
    orderBy: { created_at: 'desc' },
  })

  return admins.map(serializeAdmin)
}

export async function createAdmin(input: {
  email: string
  name: string
  password: string
  role: string
}) {
  const email = input.email.trim().toLowerCase()
  const existing = await db.admin.findUnique({
    where: { email },
    select: { id: true },
  })
  if (existing) {
    return null
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST)
  const admin = await db.admin.create({
    data: {
      email,
      is_active: true,
      name: input.name.trim(),
      password_hash: passwordHash,
      role: input.role,
    },
  })

  return serializeAdmin(admin)
}

export async function updateAdminAccount(input: {
  id: string
  isActive?: boolean
  name?: string
  role?: string
}) {
  const current = await db.admin.findUnique({
    where: { id: input.id },
  })
  if (!current) {
    return null
  }

  const admin = await db.admin.update({
    data: {
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
    },
    where: { id: input.id },
  })

  return serializeAdmin(admin)
}
