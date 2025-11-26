-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_primaryCMId_fkey";

-- AlterTable
ALTER TABLE "Client" ALTER COLUMN "primaryCMId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_primaryCMId_fkey" FOREIGN KEY ("primaryCMId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
