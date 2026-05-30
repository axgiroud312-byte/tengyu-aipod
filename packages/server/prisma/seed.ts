import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()
const BCRYPT_COST = 12

async function main() {
  const email = process.env.ADMIN_INITIAL_EMAIL
  const password = process.env.ADMIN_INITIAL_PASSWORD

  if (email && password) {
    const password_hash = await bcrypt.hash(password, BCRYPT_COST)

    await prisma.admin.upsert({
      where: { email },
      update: {
        password_hash,
        is_active: true,
      },
      create: {
        email,
        password_hash,
        name: '初始管理员',
        role: 'super',
      },
    })
  } else {
    console.warn('ADMIN_INITIAL_EMAIL or ADMIN_INITIAL_PASSWORD is missing; admin seed skipped')
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error: unknown) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
