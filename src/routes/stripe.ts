import { Router, Request, Response } from "express";

// Placeholder webhook handler so /api/stripe/webhook works at least on a basic level.
// This does NOT verify real Stripe signatures or process real events.
export function stripeWebhookHandler(req: Request, res: Response) {
  console.log("Stripe webhook placeholder hit");
  return res.status(200).send("ok");
}

// Basic router stub for /api/stripe routes.
// All routes just respond with "Stripe not configured".
const router = Router();

// Example placeholder endpoints – adapt later when you really integrate Stripe.
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
