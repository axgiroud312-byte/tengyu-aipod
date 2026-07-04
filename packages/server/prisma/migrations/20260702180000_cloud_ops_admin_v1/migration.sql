ALTER TABLE "skills"
ADD COLUMN "target_scope" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN "target_php_uids_json" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "announcements"
ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "target_scope" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN "target_php_uids_json" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "client_versions"
ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "target_scope" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN "target_php_uids_json" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "client_versions" DROP CONSTRAINT "client_versions_pkey";
ALTER TABLE "client_versions" ADD CONSTRAINT "client_versions_pkey" PRIMARY KEY ("version", "platform", "channel");
