/*
  Warnings:

  - Added the required column `fileUrl` to the `Report` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodEnd` to the `Report` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodStart` to the `Report` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "fileUrl" TEXT NOT NULL,
ADD COLUMN     "periodEnd" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "periodStart" TIMESTAMP(3) NOT NULL;
