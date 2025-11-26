// backend/src/middleware/requireAdmin.ts
import { Request, Response, NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // authMiddleware should already be attaching the user to req
  const user = (req as any).user;

  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Admin role required" });
  }

  next();
}


