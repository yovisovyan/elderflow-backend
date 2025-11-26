import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { AuthRequest } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/users
 * Admin-only list of users. Optional query: ?role=care_manager
 */
router.get("/", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { role } = req.query;

    const where: any = {
      orgId: req.user.orgId,
    };

    if (role && typeof role === "string") {
      where.role = role;
    }

    const users = await prisma.user.findMany({
      where,
      include: {
        _count: {
          select: {
            clients: true, // relation "PrimaryCM" on User
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        clientsCount: u._count.clients,
        profileImageUrl: u.profileImageUrl,
        title: u.title,
        createdAt: u.createdAt,
      })),
    });
  } catch (err) {
    console.error("Error fetching users:", err);
    return res.status(500).json({ error: "Failed to fetch users." });
  }
});

/**
 * GET /api/users/:id/summary
 * Admin-only – details for a specific user with assigned clients.
 */
router.get(
  "/:id/summary",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          orgId: true,
          profileImageUrl: true,
          title: true,
          phone: true,
        },
      });

      if (!user || user.orgId !== req.user.orgId) {
        return res.status(404).json({ error: "User not found" });
      }

      const clients = await prisma.client.findMany({
        where: {
          orgId: req.user.orgId,
          primaryCMId: id,
        },
        select: {
          id: true,
          name: true,
          status: true,
        },
        orderBy: { name: "asc" },
      });

      return res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
          profileImageUrl: user.profileImageUrl,
          title: user.title,
          phone: user.phone,
        },
        clients,
      });
    } catch (err) {
      console.error("Error fetching user summary:", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch user summary." });
    }
  }
);

/**
 * POST /api/users
 * Admin-only – create a new user (role: care_manager or admin).
 * Body: { name, email, password, role?, profileImageUrl?, title?, phone?, clientIds?[] }
 */
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const authUser = req.user;

    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (authUser.role !== "admin") {
      return res.status(403).json({ error: "Admin role required" });
    }

    if (!authUser.orgId) {
      console.error("create user: authUser.orgId is missing", authUser);
      return res.status(400).json({
        error: "Current user is not associated with an organization.",
      });
    }

    const {
      name,
      email,
      password,
      role,
      profileImageUrl,
      title,
      phone,
      clientIds,
    } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
      profileImageUrl?: string;
      title?: string;
      phone?: string;
      clientIds?: string[];
    };

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "name, email and password are required." });
    }

    const normalizedRole =
      role === "admin" || role === "care_manager" ? role : "care_manager";

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        orgId: authUser.orgId,
        role: normalizedRole,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: passwordHash,
        profileImageUrl: profileImageUrl?.trim() || null,
        title: title?.trim() || null,
        phone: phone?.trim() || null,
      },
    });

    // Assign clients at creation if care_manager and clientIds provided
    if (
      normalizedRole === "care_manager" &&
      Array.isArray(clientIds) &&
      clientIds.length > 0
    ) {
      await prisma.client.updateMany({
        where: {
          orgId: authUser.orgId,
          id: {
            in: clientIds,
          },
        },
        data: {
          primaryCMId: user.id,
        },
      });
    }

    return res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      profileImageUrl: user.profileImageUrl,
      title: user.title,
      phone: user.phone,
    });
  } catch (err: any) {
    console.error("Error creating user:", err);

    if (err.code === "P2002") {
      return res.status(409).json({ error: "Email already in use." });
    }

    return res.status(500).json({ error: "Failed to create user." });
  }
});

/**
 * PATCH /api/users/:id
 * Admin-only – update care manager details (name, email, role, profile fields).
 * Body: { name?, email?, role?, profileImageUrl?, title?, phone? }
 */
router.patch(
  "/:id",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      const {
        name,
        email,
        role,
        profileImageUrl,
        title,
        phone,
      } = req.body as {
        name?: string;
        email?: string;
        role?: string;
        profileImageUrl?: string;
        title?: string;
        phone?: string;
      };

      const user = await prisma.user.findUnique({
        where: { id },
      });

      if (!user || user.orgId !== req.user.orgId) {
        return res.status(404).json({ error: "User not found" });
      }

      const data: any = {};

      if (name !== undefined) data.name = name.trim();
      if (email !== undefined) data.email = email.trim().toLowerCase();
      if (role !== undefined) {
        if (role === "admin" || role === "care_manager") {
          data.role = role;
        }
      }
      if (profileImageUrl !== undefined)
        data.profileImageUrl = profileImageUrl.trim() || null;
      if (title !== undefined) data.title = title.trim() || null;
      if (phone !== undefined) data.phone = phone.trim() || null;

      try {
        const updated = await prisma.user.update({
          where: { id: user.id },
          data,
        });

        return res.json({
          id: updated.id,
          name: updated.name,
          email: updated.email,
          role: updated.role,
          profileImageUrl: updated.profileImageUrl,
          title: updated.title,
          phone: updated.phone,
        });
      } catch (err: any) {
        if (err.code === "P2002") {
          return res
            .status(409)
            .json({ error: "Another user already uses this email." });
        }
        throw err;
      }
    } catch (err) {
      console.error("Error updating user:", err);
      return res.status(500).json({ error: "Failed to update user." });
    }
  }
);

/**
 * POST /api/users/:id/assign-clients
 * Admin-only – assign clients to a care manager.
 * Body: { clientIds: string[] }
 *
 * Uses nullable primaryCMId so unchecking unassigns clients.
 */
router.post(
  "/:id/assign-clients",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      const { clientIds } = req.body as { clientIds?: string[] };

      if (!Array.isArray(clientIds)) {
        return res
          .status(400)
          .json({ error: "clientIds must be an array of client IDs." });
      }

      const user = await prisma.user.findUnique({
        where: { id },
      });

      if (!user || user.orgId !== req.user.orgId) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "care_manager") {
        return res.status(400).json({
          error: "Only care managers can have client assignments.",
        });
      }

      const orgId = req.user.orgId;

      // UNASSIGN this CM from any clients NOT in clientIds
      await prisma.client.updateMany({
        where: {
          orgId,
          primaryCMId: id,
          NOT: {
            id: {
              in: clientIds,
            },
          },
        },
        data: {
          primaryCMId: null,
        },
      });

      // ASSIGN this CM to all specified clients
      if (clientIds.length > 0) {
        await prisma.client.updateMany({
          where: {
            orgId,
            id: {
              in: clientIds,
            },
          },
          data: {
            primaryCMId: id,
          },
        });
      }

      const clients = await prisma.client.findMany({
        where: {
          orgId,
          primaryCMId: id,
        },
        select: {
          id: true,
          name: true,
          status: true,
        },
        orderBy: { name: "asc" },
      });

      return res.json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          profileImageUrl: user.profileImageUrl,
          title: user.title,
          phone: user.phone,
        },
        clients,
      });
    } catch (err) {
      console.error("Error assigning clients to user:", err);
      return res
        .status(500)
        .json({ error: "Failed to assign clients to user." });
    }
  }
);

/**
 * DELETE /api/users/:id
 * Admin-only – delete a care manager.
 * Safety: prevent delete if they still own clients.
 */
router.delete(
  "/:id",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          _count: {
            select: { clients: true },
          },
        },
      });

      if (!user || user.orgId !== req.user.orgId) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user._count.clients > 0) {
        return res.status(400).json({
          error:
            "This care manager still has assigned clients. Reassign or remove clients before deleting.",
        });
      }

      await prisma.user.delete({
        where: { id: user.id },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting user:", err);
      return res.status(500).json({ error: "Failed to delete user." });
    }
  }
);

/**
 * GET /api/users/:id/metrics
 * Admin-only – activity metrics for a specific care manager.
 * Used by the Team list to show hours + billable ratio.
 */
router.get(
  "/:id/metrics",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;

      // Find user and verify same org
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          role: true,
          orgId: true,
        },
      });

      if (!user || user.orgId !== req.user.orgId) {
        return res.status(404).json({ error: "User not found" });
      }

      // Only makes sense for care managers, but we can still compute for others
      const cmId = user.id;
      const orgId = user.orgId;

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(
        now.getTime() - 30 * 24 * 60 * 60 * 1000
      );

      const [last7, last30] = await Promise.all([
        prisma.activity.findMany({
          where: {
            orgId,
            cmId,
            startTime: { gte: sevenDaysAgo },
          },
          select: {
            duration: true,
            isBillable: true,
          },
        }),
        prisma.activity.findMany({
          where: {
            orgId,
            cmId,
            startTime: { gte: thirtyDaysAgo },
          },
          select: {
            duration: true,
            isBillable: true,
          },
        }),
      ]);

      const sumMinutes = (
        rows: { duration: number | null; isBillable: boolean }[],
        billableOnly = false
      ) =>
        rows.reduce((sum, a) => {
          if (billableOnly && !a.isBillable) return sum;
          return sum + (a.duration || 0);
        }, 0);

      const last30Minutes = sumMinutes(last30);
      const last30BillableMinutes = sumMinutes(last30, true);
      const last30Hours = last30Minutes / 60;
      const last30BillableHours = last30BillableMinutes / 60;

      const billableRatio =
        last30Hours > 0
          ? Number((last30BillableHours / last30Hours).toFixed(2))
          : 0;

      const last7Minutes = sumMinutes(last7);
      const last7Hours = last7Minutes / 60;

      return res.json({
        last7Days: {
          hours: Number(last7Hours.toFixed(2)),
        },
        last30Days: {
          hours: Number(last30Hours.toFixed(2)),
          billableHours: Number(last30BillableHours.toFixed(2)),
          billableRatio, // 0–1
        },
      });
    } catch (err) {
      console.error("Error fetching user metrics:", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch user metrics." });
    }
  }
);


export default router;
