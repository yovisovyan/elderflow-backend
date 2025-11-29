-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "updatedById" TEXT,
ADD COLUMN     "updatedByName" TEXT;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
