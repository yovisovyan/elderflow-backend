-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isEmergencyContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProvider" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientMedication" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dosage" TEXT,
    "frequency" TEXT,
    "route" TEXT,
    "prescribingProvider" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientMedication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAllergy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allergen" TEXT NOT NULL,
    "reaction" TEXT,
    "severity" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAllergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientInsurance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "insuranceType" TEXT,
    "carrier" TEXT,
    "policyNumber" TEXT,
    "groupNumber" TEXT,
    "memberId" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRisk" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT,
    "category" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientContact_orgId_idx" ON "ClientContact"("orgId");

-- CreateIndex
CREATE INDEX "ClientContact_clientId_idx" ON "ClientContact"("clientId");

-- CreateIndex
CREATE INDEX "ClientProvider_orgId_idx" ON "ClientProvider"("orgId");

-- CreateIndex
CREATE INDEX "ClientProvider_clientId_idx" ON "ClientProvider"("clientId");

-- CreateIndex
CREATE INDEX "ClientProvider_type_idx" ON "ClientProvider"("type");

-- CreateIndex
CREATE INDEX "ClientMedication_orgId_idx" ON "ClientMedication"("orgId");

-- CreateIndex
CREATE INDEX "ClientMedication_clientId_idx" ON "ClientMedication"("clientId");

-- CreateIndex
CREATE INDEX "ClientMedication_name_idx" ON "ClientMedication"("name");

-- CreateIndex
CREATE INDEX "ClientAllergy_orgId_idx" ON "ClientAllergy"("orgId");

-- CreateIndex
CREATE INDEX "ClientAllergy_clientId_idx" ON "ClientAllergy"("clientId");

-- CreateIndex
CREATE INDEX "ClientAllergy_allergen_idx" ON "ClientAllergy"("allergen");

-- CreateIndex
CREATE INDEX "ClientInsurance_orgId_idx" ON "ClientInsurance"("orgId");

-- CreateIndex
CREATE INDEX "ClientInsurance_clientId_idx" ON "ClientInsurance"("clientId");

-- CreateIndex
CREATE INDEX "ClientInsurance_carrier_idx" ON "ClientInsurance"("carrier");

-- CreateIndex
CREATE INDEX "ClientRisk_orgId_idx" ON "ClientRisk"("orgId");

-- CreateIndex
CREATE INDEX "ClientRisk_clientId_idx" ON "ClientRisk"("clientId");

-- CreateIndex
CREATE INDEX "ClientRisk_category_idx" ON "ClientRisk"("category");

-- CreateIndex
CREATE INDEX "ClientDocument_orgId_idx" ON "ClientDocument"("orgId");

-- CreateIndex
CREATE INDEX "ClientDocument_clientId_idx" ON "ClientDocument"("clientId");

-- CreateIndex
CREATE INDEX "ClientDocument_category_idx" ON "ClientDocument"("category");

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProvider" ADD CONSTRAINT "ClientProvider_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProvider" ADD CONSTRAINT "ClientProvider_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMedication" ADD CONSTRAINT "ClientMedication_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMedication" ADD CONSTRAINT "ClientMedication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAllergy" ADD CONSTRAINT "ClientAllergy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAllergy" ADD CONSTRAINT "ClientAllergy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInsurance" ADD CONSTRAINT "ClientInsurance_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInsurance" ADD CONSTRAINT "ClientInsurance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRisk" ADD CONSTRAINT "ClientRisk_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRisk" ADD CONSTRAINT "ClientRisk_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
