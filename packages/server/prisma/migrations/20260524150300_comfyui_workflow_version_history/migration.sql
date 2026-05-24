CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "comfyui_workflows" DROP CONSTRAINT "comfyui_workflows_pkey";
ALTER TABLE "comfyui_workflows" ADD COLUMN "row_id" TEXT;
UPDATE "comfyui_workflows" SET "row_id" = gen_random_uuid()::text WHERE "row_id" IS NULL;
ALTER TABLE "comfyui_workflows" ALTER COLUMN "row_id" SET NOT NULL;
ALTER TABLE "comfyui_workflows" ADD CONSTRAINT "comfyui_workflows_pkey" PRIMARY KEY ("row_id");
