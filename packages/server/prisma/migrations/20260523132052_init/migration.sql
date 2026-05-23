-- CreateEnum
CREATE TYPE "SkillModule" AS ENUM ('generation', 'detection', 'title');

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "wechat" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activation_codes" (
    "code" TEXT NOT NULL,
    "customer_id" TEXT,
    "batch_id" TEXT,
    "days_total" INTEGER NOT NULL,
    "max_devices" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "device_activations" (
    "id" TEXT NOT NULL,
    "code_id" TEXT NOT NULL,
    "device_fingerprint" TEXT NOT NULL,
    "device_name" TEXT,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "module" "SkillModule" NOT NULL,
    "category" TEXT,
    "platform" TEXT,
    "language" TEXT,
    "version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "system_prompt" TEXT NOT NULL,
    "variables_json" TEXT NOT NULL,
    "recommended_model" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "fallback_url" TEXT,
    "api_style" TEXT NOT NULL,
    "endpoints_json" TEXT NOT NULL,
    "model_options_json" TEXT NOT NULL,
    "default_params_json" TEXT NOT NULL,
    "capabilities" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comfyui_workflows" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "workflow_json" TEXT NOT NULL,
    "input_slots_json" TEXT NOT NULL,
    "output_slots_json" TEXT NOT NULL,
    "required_models" TEXT[],
    "recommended_pod_keywords" TEXT[],
    "min_vram_gb" INTEGER NOT NULL DEFAULT 8,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comfyui_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_rules" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rules_json" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_rules_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "audience" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_versions" (
    "version" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "force_upgrade" BOOLEAN NOT NULL DEFAULT false,
    "download_url_win" TEXT,
    "download_url_mac" TEXT,
    "changelog" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_versions_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_errors" (
    "id" TEXT NOT NULL,
    "client_version" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "error_code" TEXT NOT NULL,
    "error_message" TEXT NOT NULL,
    "stack_trace" TEXT,
    "device_fingerprint" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "activation_codes_customer_id_idx" ON "activation_codes"("customer_id");

-- CreateIndex
CREATE INDEX "activation_codes_batch_id_idx" ON "activation_codes"("batch_id");

-- CreateIndex
CREATE INDEX "device_activations_device_fingerprint_idx" ON "device_activations"("device_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "device_activations_code_id_device_fingerprint_key" ON "device_activations"("code_id", "device_fingerprint");

-- CreateIndex
CREATE INDEX "skills_module_category_idx" ON "skills"("module", "category");

-- CreateIndex
CREATE INDEX "skills_module_platform_language_idx" ON "skills"("module", "platform", "language");

-- CreateIndex
CREATE UNIQUE INDEX "skills_id_version_key" ON "skills"("id", "version");

-- CreateIndex
CREATE INDEX "comfyui_workflows_category_enabled_idx" ON "comfyui_workflows"("category", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "comfyui_workflows_id_version_key" ON "comfyui_workflows"("id", "version");

-- CreateIndex
CREATE INDEX "announcements_start_at_end_at_idx" ON "announcements"("start_at", "end_at");

-- CreateIndex
CREATE INDEX "client_versions_channel_published_at_idx" ON "client_versions"("channel", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "telemetry_errors_error_code_occurred_at_idx" ON "telemetry_errors"("error_code", "occurred_at");

-- CreateIndex
CREATE INDEX "telemetry_errors_module_occurred_at_idx" ON "telemetry_errors"("module", "occurred_at");

-- AddForeignKey
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_activations" ADD CONSTRAINT "device_activations_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "activation_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
