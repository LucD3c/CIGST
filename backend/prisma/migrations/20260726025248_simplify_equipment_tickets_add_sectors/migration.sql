/*
  Warnings:

  - You are about to drop the column `sector` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `asset` on the `equipment` table. All the data in the column will be lost.
  - You are about to drop the column `brand` on the `equipment` table. All the data in the column will be lost.
  - You are about to drop the column `employee_id` on the `equipment` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `equipment` table. All the data in the column will be lost.
  - You are about to drop the column `serial` on the `equipment` table. All the data in the column will be lost.
  - You are about to drop the column `warranty` on the `equipment` table. All the data in the column will be lost.
  - You are about to drop the column `impact` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `tickets` table. All the data in the column will be lost.
  - You are about to drop the column `replacement_id` on the `tickets` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "equipment" DROP CONSTRAINT "equipment_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "logbook_entries" DROP CONSTRAINT "logbook_entries_author_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_replacement_id_fkey";

-- DropIndex
DROP INDEX "equipment_employee_id_idx";

-- DropIndex
DROP INDEX "tickets_replacement_id_idx";

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "sector",
ADD COLUMN     "sector_id" TEXT;

-- AlterTable
ALTER TABLE "equipment" DROP COLUMN "asset",
DROP COLUMN "brand",
DROP COLUMN "employee_id",
DROP COLUMN "location",
DROP COLUMN "serial",
DROP COLUMN "warranty",
ADD COLUMN     "sector_id" TEXT,
ALTER COLUMN "status" SET DEFAULT 'Activo';

-- AlterTable
ALTER TABLE "logbook_entries" ALTER COLUMN "author_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tickets" DROP COLUMN "impact",
DROP COLUMN "location",
DROP COLUMN "replacement_id",
ADD COLUMN     "sector_id" TEXT;

-- CreateTable
CREATE TABLE "sectors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Activo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sectors_name_key" ON "sectors"("name");

-- CreateIndex
CREATE INDEX "employees_sector_id_idx" ON "employees"("sector_id");

-- CreateIndex
CREATE INDEX "equipment_sector_id_idx" ON "equipment"("sector_id");

-- CreateIndex
CREATE INDEX "tickets_sector_id_idx" ON "tickets"("sector_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logbook_entries" ADD CONSTRAINT "logbook_entries_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
