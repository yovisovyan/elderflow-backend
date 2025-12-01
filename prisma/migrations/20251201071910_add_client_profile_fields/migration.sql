-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "environmentSafetyNotes" TEXT,
ADD COLUMN     "insurance" TEXT,
ADD COLUMN     "livingSituation" TEXT,
ADD COLUMN     "physicianName" TEXT,
ADD COLUMN     "physicianPhone" TEXT,
ADD COLUMN     "preferredName" TEXT,
ADD COLUMN     "primaryDiagnosis" TEXT,
ADD COLUMN     "primaryLanguage" TEXT,
ADD COLUMN     "riskFlags" JSONB;
