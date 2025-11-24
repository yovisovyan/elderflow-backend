/*
  Warnings:

  - You are about to drop the column `processor` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `processorRef` on the `Payment` table. All the data in the column will be lost.
  - Made the column `paidAt` on table `Payment` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "processor",
DROP COLUMN "processorRef",
ALTER COLUMN "status" SET DEFAULT 'completed',
ALTER COLUMN "paidAt" SET NOT NULL,
ALTER COLUMN "paidAt" SET DEFAULT CURRENT_TIMESTAMP;
