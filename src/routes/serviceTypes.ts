import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/service-types
 * List all service types for the current org.
 */
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const services = await prisma.serviceType.findMany({
      where: {
        orgId: req.user.orgId,
        isActive: true,
      },
      orderBy: { name: "asc" },
    });

    return res.json({ services });
  } catch (err) {
    console.error("Error fetching service types:", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch service types." });
  }
});

/**
 * POST /api/service-types/bulk-sync
 * ADMIN ONLY – upsert service types from the UI and remove those no longer present.
 * Body: { services: { id?, name, billingCode?, rateType, rateAmount }[] }
 */
router.post(
  "/bulk-sync",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { services } = req.body as {
        services?: {
          id?: string;
          name?: string;
          billingCode?: string | null;
          rateType?: string;
          rateAmount?: number;
        }[];
      };

      if (!services || !Array.isArray(services)) {
        return res.status(400).json({ error: "Invalid services payload." });
      }

      const orgId = req.user.orgId;

      const existing = await prisma.serviceType.findMany({
        where: { orgId },
      });

      const incomingIds = new Set<string>();

      const operations = services.map((svc) => {
        const { id, name, billingCode, rateType, rateAmount } = svc;

        if (!name || !rateType || rateAmount == null) {
          return null;
        }

        const normalizedRateType =
          rateType === "flat" ? "flat" : "hourly"; // default to hourly

        if (id) {
          incomingIds.add(id);
          return prisma.serviceType.update({
            where: { id },
            data: {
              name: name.trim(),
              billingCode: billingCode?.trim() || null,
              rateType: normalizedRateType,
              rateAmount,
              isActive: true,
            },
          });
        }

        // create new
        return prisma.serviceType.create({
          data: {
            orgId,
            name: name.trim(),
            billingCode: billingCode?.trim() || null,
            rateType: normalizedRateType,
            rateAmount,
          },
        });
      });

      const filteredOps = operations.filter(Boolean) as any[];

      // delete any existing services not present in incomingIds
      const deleteOps = existing
        .filter((svc) => !incomingIds.has(svc.id))
        .map((svc) =>
          prisma.serviceType.update({
            where: { id: svc.id },
            data: { isActive: false },
          })
        );

      await prisma.$transaction([...filteredOps, ...deleteOps]);

      const updated = await prisma.serviceType.findMany({
        where: { orgId, isActive: true },
        orderBy: { name: "asc" },
      });

      return res.json({ services: updated });
    } catch (err) {
      console.error("Error bulk syncing service types:", err);
      return res
        .status(500)
        .json({ error: "Failed to save service types." });
    }
  }
);

export default router;
