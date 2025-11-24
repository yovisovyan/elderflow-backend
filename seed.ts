import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // 1) Create organization
  const org = await prisma.organization.create({
    data: {
      name: "ElderFlow Demo Agency",
      contactEmail: "owner@elderflow-demo.com",
      billingPlan: "standard_12_per_client",
    },
  });

  console.log("✅ Created org:", org.name);

  // 2) Create users (Dennis admin, Robbin care manager)
  const adminPassword = await bcrypt.hash("Password123!", 10);
  const cmPassword = await bcrypt.hash("Password123!", 10);

  const dennis = await prisma.user.create({
    data: {
      orgId: org.id,
      role: "admin",
      name: "Dennis Owner",
      email: "demo+admin@elderflow.ai",
      password: adminPassword,
    },
  });

  const robbin = await prisma.user.create({
    data: {
      orgId: org.id,
      role: "care_manager",
      name: "Robbin Adams",
      email: "demo+robbin@elderflow.ai",
      password: cmPassword,
    },
  });

  console.log("✅ Created users:", dennis.email, robbin.email);

  // 3) Create clients
  const client1 = await prisma.client.create({
    data: {
      orgId: org.id,
      primaryCMId: robbin.id,
      name: "Margaret Johnson",
      dob: new Date("1943-05-21"),
      address: "123 Palm Tree Lane, Melbourne, FL",
      billingContactName: "John Johnson",
      billingContactEmail: "john.johnson@example.com",
      billingContactPhone: "+1-555-111-2222",
      billingRulesJson: {
        hourly_rate: 175,
        visit_fee: 50,
        mileage_rate: 0.65,
        emergency_multiplier: 1.5,
        retainer_amount: 1000,
        retainer_low_threshold: 250,
      },
      status: "active",
    },
  });

  const client2 = await prisma.client.create({
    data: {
      orgId: org.id,
      primaryCMId: robbin.id,
      name: "Robert Smith",
      dob: new Date("1948-10-05"),
      address: "456 River Road, Cocoa, FL",
      billingContactName: "Linda Smith",
      billingContactEmail: "linda.smith@example.com",
      billingContactPhone: "+1-555-333-4444",
      billingRulesJson: {
        hourly_rate: 150,
        visit_fee: 40,
        mileage_rate: 0.6,
        emergency_multiplier: 2.0,
        retainer_amount: 500,
        retainer_low_threshold: 150,
      },
      status: "active",
    },
  });

  console.log("✅ Created clients:", client1.name, client2.name);

  // 4) Create some activities for the last few days
  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;

  function makeTimeOffset(daysAgo: number, minutes: number) {
    const start = new Date(now.getTime() - daysAgo * oneDayMs);
    const end = new Date(start.getTime() + minutes * 60 * 1000);
    return { start, end };
  }

  const act1Time = makeTimeOffset(2, 45); // 45-min call 2 days ago
  const act2Time = makeTimeOffset(1, 75); // 75-min visit 1 day ago
  const act3Time = makeTimeOffset(0, 20); // 20-min email today

  const activity1 = await prisma.activity.create({
    data: {
      orgId: org.id,
      clientId: client1.id,
      cmId: robbin.id,
      source: "phone",
      startTime: act1Time.start,
      endTime: act1Time.end,
      duration: 45,
      billingCode: "Phone Support",
      isBillable: true,
      aiConfidence: 0.92,
      notes: "Phone call with family regarding medication schedule.",
      isFlagged: false,
      capturedByAi: false,
    },
  });

  const activity2 = await prisma.activity.create({
    data: {
      orgId: org.id,
      clientId: client1.id,
      cmId: robbin.id,
      source: "visit",
      startTime: act2Time.start,
      endTime: act2Time.end,
      duration: 75,
      billingCode: "Home Visit",
      isBillable: true,
      aiConfidence: 0.88,
      notes: "Home visit – safety assessment and care coordination.",
      isFlagged: false,
      capturedByAi: false,
    },
  });

  const activity3 = await prisma.activity.create({
    data: {
      orgId: org.id,
      clientId: client2.id,
      cmId: robbin.id,
      source: "email",
      startTime: act3Time.start,
      endTime: act3Time.end,
      duration: 20,
      billingCode: "Care Coordination",
      isBillable: true,
      aiConfidence: 0.81,
      notes: "Email summary sent to family and primary doctor.",
      isFlagged: true, // flagged due to lower confidence
      capturedByAi: false,
    },
  });

  console.log("✅ Created activities:", activity1.id, activity2.id, activity3.id);

  console.log("🌱 Seeding complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
