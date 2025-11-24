import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/activities
 * Query params:
 *  - clientId (optional)
 *  - flagged (optional: "true" or "false")
 */
router.get("/", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { clientId, flagged } = req.query;

    const where: any = {
      orgId: req.user.orgId,
    };

    if (clientId) where.clientId = clientId;
    if (flagged === "true") where.isFlagged = true;
    if (flagged === "false") where.isFlagged = false;

    const activities = await prisma.activity.findMany({
      where,
      orderBy: { startTime: "desc" },
      include: {
        client: true,
        cm: true,
      },
    });

    res.json(activities);
  } catch (err) {
    console.error("Error fetching activities:", err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
});

/**
 * GET /api/activities/:id
 * Returns a single activity with related client & care manager.
 */
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    const activity = await prisma.activity.findFirst({
      where: {
        id,
        orgId: req.user.orgId,
      },
      include: {
        client: true,
        cm: true,
      },
    });

    if (!activity) {
      return res.status(404).json({ error: "Activity not found" });
    }

    res.json(activity);
  } catch (err) {
    console.error("Error fetching activity:", err);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

/**
 * POST /api/activities
 * Creates a manual activity entry (not AI-generated).
 * Body:
 *  - clientId
 *  - source ("phone" | "email" | "visit" | "manual")
 *  - startTime (ISO string)
 *  - endTime (ISO string)
 *  - billingCode (optional)
 *  - isBillable (boolean)
 *  - notes (string)
 */
router.post("/", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const {
      clientId,
      source,
      startTime,
      endTime,
      billingCode,
      isBillable,
      notes,
    } = req.body;

    if (!clientId || !source || !startTime || !endTime) {
      return res
        .status(400)
        .json({ error: "clientId, source, startTime, endTime are required" });
    }

    

    const start = new Date(startTime);
    const end = new Date(endTime);
    const duration = Math.round((end.getTime() - start.getTime()) / 60000); // minutes

    const activity = await prisma.activity.create({
      data: {
        orgId: req.user.orgId,
        clientId,
        cmId: req.user.userId,
        source,
        startTime: start,
        endTime: end,
        duration,
        billingCode: billingCode ?? null,
        isBillable: isBillable ?? true,
        aiConfidence: 0.95, // manual entry assumed high confidence
        notes: notes ?? "",
        isFlagged: false,
        capturedByAi: false,
      },
    });

    res.status(201).json(activity);
  } catch (err) {
    console.error("Error creating activity:", err);
    res.status(500).json({ error: "Failed to create activity" });
  }
  
});




export default router;
