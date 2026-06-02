CREATE TYPE "CustomerAccountStatus" AS ENUM ('pending', 'active', 'disabled');

CREATE TABLE "customer_accounts" (
  "id" TEXT NOT NULL,
  "php_uid" INTEGER NOT NULL,
  "nickname" TEXT,
  "avatar_url" TEXT,
  "phone" TEXT,
  "account" TEXT,
  "status" "CustomerAccountStatus" NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMP(3),
  "notes" TEXT,
  "approved_at" TIMESTAMP(3),
  "approved_by_admin_id" TEXT,
  "disabled_at" TIMESTAMP(3),
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_accounts_php_uid_key" ON "customer_accounts"("php_uid");
CREATE INDEX "customer_accounts_status_idx" ON "customer_accounts"("status");
CREATE INDEX "customer_accounts_phone_idx" ON "customer_accounts"("phone");
CREATE INDEX "customer_accounts_expires_at_idx" ON "customer_accounts"("expires_at");
