-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Activo',
    "last_access_at" TIMESTAMP(3),
    "login_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "extension" TEXT,
    "sector" TEXT,
    "position" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Activo',
    "work_shift" TEXT,
    "schedule" TEXT,
    "replacement_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serial" TEXT,
    "asset" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Operativo',
    "employee_id" TEXT,
    "location" TEXT,
    "warranty" TEXT DEFAULT 'No registrada',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "employee_id" TEXT NOT NULL,
    "requested_by_id" TEXT,
    "replacement_id" TEXT,
    "equipment_id" TEXT,
    "location" TEXT,
    "contact" TEXT,
    "availability" TEXT,
    "support_shift" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "impact" TEXT NOT NULL DEFAULT 'Individual',
    "technician_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Nuevo',
    "priority" TEXT NOT NULL DEFAULT 'Media',
    "solution" TEXT,
    "time_spent" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logbook_entries" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "detail" TEXT,
    "author_id" TEXT NOT NULL,
    "related_ticket_id" TEXT,
    "related_equipment_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "logbook_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE INDEX "users_employee_id_idx" ON "users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "employees_code_key" ON "employees"("code");

-- CreateIndex
CREATE INDEX "employees_replacement_id_idx" ON "employees"("replacement_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_code_key" ON "equipment"("code");

-- CreateIndex
CREATE INDEX "equipment_employee_id_idx" ON "equipment"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_code_key" ON "tickets"("code");

-- CreateIndex
CREATE INDEX "tickets_employee_id_idx" ON "tickets"("employee_id");

-- CreateIndex
CREATE INDEX "tickets_requested_by_id_idx" ON "tickets"("requested_by_id");

-- CreateIndex
CREATE INDEX "tickets_replacement_id_idx" ON "tickets"("replacement_id");

-- CreateIndex
CREATE INDEX "tickets_equipment_id_idx" ON "tickets"("equipment_id");

-- CreateIndex
CREATE INDEX "tickets_technician_id_idx" ON "tickets"("technician_id");

-- CreateIndex
CREATE INDEX "tickets_created_by_id_idx" ON "tickets"("created_by_id");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "logbook_entries_code_key" ON "logbook_entries"("code");

-- CreateIndex
CREATE INDEX "logbook_entries_author_id_idx" ON "logbook_entries"("author_id");

-- CreateIndex
CREATE INDEX "logbook_entries_related_ticket_id_idx" ON "logbook_entries"("related_ticket_id");

-- CreateIndex
CREATE INDEX "logbook_entries_related_equipment_id_idx" ON "logbook_entries"("related_equipment_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_replacement_id_fkey" FOREIGN KEY ("replacement_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_replacement_id_fkey" FOREIGN KEY ("replacement_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logbook_entries" ADD CONSTRAINT "logbook_entries_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logbook_entries" ADD CONSTRAINT "logbook_entries_related_ticket_id_fkey" FOREIGN KEY ("related_ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logbook_entries" ADD CONSTRAINT "logbook_entries_related_equipment_id_fkey" FOREIGN KEY ("related_equipment_id") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
