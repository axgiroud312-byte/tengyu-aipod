-- AlterTable
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "skills" DROP CONSTRAINT "skills_pkey";
ALTER TABLE "skills" ADD COLUMN "row_id" TEXT;
UPDATE "skills" SET "row_id" = gen_random_uuid()::text WHERE "row_id" IS NULL;
ALTER TABLE "skills" ALTER COLUMN "row_id" SET NOT NULL;
ALTER TABLE "skills" ADD CONSTRAINT "skills_pkey" PRIMARY KEY ("row_id");
