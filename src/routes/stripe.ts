// src/routes/stripe.ts
import { Router, Request, Response } from "express";

// 🔹 Placeholder webhook handler so /api/stripe/webhook doesn't break.
// This does NOT validate real Stripe signatures or process real events.
export function stripeWebhookHandler(req: Request, res: Response) {
  console.log("Stripe webhook placeholder hit");
  return res.status(200).send("ok");
}

// 🔹 Basic router stub for /api/stripe routes.
// All endpoints just say "Stripe not configured" for now.
const router = Router();

router.get("/config", (_req: Request, res: Response) => {
  return res.json({
    stripeEnabled: false,
    message: "Stripe is not configured on this environment.",
  });
});

router.post("/checkout-session", (_req: Request, res: Response) => {
  return res.status(501).json({
    error: "Stripe checkout is not enabled yet.",
  });
});

export default router;
