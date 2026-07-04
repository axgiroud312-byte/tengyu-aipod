import { db } from '@/lib/db'
import { compareVersions } from '@/lib/skills'
import { type TargetScope, matchesPhpUidTarget } from '@/lib/targeting'
import type { ClientVersion } from '@prisma/client'

export type ClientVersionCheckResult = {
  changelog: string | null
  download_url: string | null
  force_upgrade: boolean
  latest_version: string | null
  update_available: boolean
}

function downloadUrlForPlatform(version: ClientVersion) {
  return version.platform === 'macos' ? version.download_url_mac : version.download_url_win
}

export async function checkClientVersion(input: {
  channel: string
  current: string
  platform: string
  uid: number | null
}): Promise<ClientVersionCheckResult> {
  const versions = await db.clientVersion.findMany({
    orderBy: [{ published_at: 'desc' }],
    where: {
      channel: input.channel,
      enabled: true,
      platform: input.platform,
    },
  })
  const [latest] = versions
    .filter((version) =>
      matchesPhpUidTarget({
        scope: version.target_scope as TargetScope,
        targetPhpUidsJson: version.target_php_uids_json,
        uid: input.uid,
      }),
    )
    .sort((left, right) => compareVersions(right.version, left.version))

  if (!latest) {
    return {
      changelog: null,
      download_url: null,
      force_upgrade: false,
      latest_version: null,
      update_available: false,
    }
  }

  const updateAvailable = compareVersions(latest.version, input.current) > 0

  return {
    changelog: latest.changelog,
    download_url: downloadUrlForPlatform(latest),
    force_upgrade: latest.force_upgrade && updateAvailable,
    latest_version: latest.version,
    update_available: updateAvailable,
  }
}
