import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()
const BCRYPT_COST = 12
const DEFAULT_TITLE_SKILL = {
  id: 'title-generic-generic',
  version: '1.0.0',
  module: 'title' as const,
  category: null,
  platform: 'generic',
  language: 'generic',
  enabled: true,
  system_prompt: [
    '你是跨境电商 POD 商品标题写作助手。根据用户提供的商品图或成品图，生成适合上架的标题。',
    '',
    '要求：',
    '- 只输出最终标题字符串，不要解释、编号、引号或 Markdown。',
    '- 必须使用用户消息中指定的目标语言。',
    '- 结合图片主体、风格、适用人群、场景和商品品类。',
    '- 不要编造图片中看不出的品牌、材质、授权角色、官方 IP、商标词或名人名。',
    '- 避免侵权品牌词、影视动漫游戏角色名和误导性描述。',
  ].join('\n'),
  variables_json: '[]',
  recommended_model: 'qwen3.6-flash',
  notes: '标题生成提示词：通用标题生成兜底 Skill。',
}

async function seedDefaultTitleSkill() {
  const existing = await prisma.skill.findUnique({
    where: {
      id_version: {
        id: DEFAULT_TITLE_SKILL.id,
        version: DEFAULT_TITLE_SKILL.version,
      },
    },
  })

  if (existing) {
    return
  }

  await prisma.skill.create({
    data: DEFAULT_TITLE_SKILL,
  })
}

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

  await seedDefaultTitleSkill()
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
