import { db } from '@/lib/db'
import { type TargetScope, matchesPhpUidTarget } from '@/lib/targeting'
import type { Announcement } from '@prisma/client'

export type AnnouncementLevel = 'info' | 'important' | 'warning'

export type SerializedAnnouncement = {
  content: string
  end_at: string | null
  id: string
  level: string
  start_at: string
  title: string
}

export function serializeAnnouncement(announcement: Announcement): SerializedAnnouncement {
  return {
    content: announcement.content,
    end_at: announcement.end_at ? announcement.end_at.toISOString() : null,
    id: announcement.id,
    level: announcement.level,
    start_at: announcement.start_at.toISOString(),
    title: announcement.title,
  }
}

export async function listActiveAnnouncements(input: { now?: Date; uid: number | null }) {
  const now = input.now ?? new Date()
  const announcements = await db.announcement.findMany({
    orderBy: [{ start_at: 'desc' }, { created_at: 'desc' }],
    where: {
      enabled: true,
      start_at: { lte: now },
      OR: [{ end_at: null }, { end_at: { gte: now } }],
    },
  })

  return announcements
    .filter((announcement) =>
      matchesPhpUidTarget({
        scope: announcement.target_scope as TargetScope,
        targetPhpUidsJson: announcement.target_php_uids_json,
        uid: input.uid,
      }),
    )
    .map(serializeAnnouncement)
}
