-- CreateTable
CREATE TABLE "mail_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imap_host" TEXT NOT NULL,
    "imap_port" INTEGER NOT NULL,
    "imap_secure" BOOLEAN NOT NULL DEFAULT true,
    "smtp_host" TEXT NOT NULL,
    "smtp_port" INTEGER NOT NULL,
    "smtp_security" TEXT NOT NULL DEFAULT 'starttls',
    "allow_internal" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Activo',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "mail_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_accounts" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "auth_user" TEXT,
    "secret_cipher" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Activo',
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "mail_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_account_access" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT,
    "sector_id" TEXT,

    CONSTRAINT "mail_account_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_providers_name_key" ON "mail_providers"("name");

-- CreateIndex
CREATE INDEX "mail_accounts_owner_user_id_idx" ON "mail_accounts"("owner_user_id");

-- CreateIndex
CREATE INDEX "mail_accounts_provider_id_idx" ON "mail_accounts"("provider_id");

-- CreateIndex
CREATE INDEX "mail_account_access_account_id_idx" ON "mail_account_access"("account_id");

-- CreateIndex
CREATE INDEX "mail_account_access_user_id_idx" ON "mail_account_access"("user_id");

-- CreateIndex
CREATE INDEX "mail_account_access_sector_id_idx" ON "mail_account_access"("sector_id");

-- AddForeignKey
ALTER TABLE "mail_providers" ADD CONSTRAINT "mail_providers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "mail_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_account_access" ADD CONSTRAINT "mail_account_access_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_account_access" ADD CONSTRAINT "mail_account_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_account_access" ADD CONSTRAINT "mail_account_access_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
