// backend/src/routes/stripe.ts
import { Router } from "express";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import type { Request, Response } from "express";

const router = Router();
const prisma = new PrismaClient();


const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20", // or latest Stripe API version
});
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string | undefined;

/**
 * POST /api/stripe/create-checkout-session/:invoiceId
 *
 * Creates a Stripe Checkout Session for a given invoice.
 * Returns { url } for the frontend to redirect to.
 */
router.post(
  "/create-checkout-session/:invoiceId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { invoiceId } = req.params;
      

      const invoice = await prisma.invoice.findFirst({
        where: {
          id: invoiceId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      if (!invoice.totalAmount || invoice.totalAmount <= 0) {
        return res
          .status(400)
          .json({ error: "Invoice total amount must be greater than 0" });
      }

      const amountInCents = Math.round(invoice.totalAmount * 100);

      const frontendBaseUrl =
        process.env.FRONTEND_BASE_URL ?? "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `ElderFlow Invoice ${invoice.id}`,
              },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        metadata: {
          invoiceId: invoice.id,
          orgId: req.user.orgId,
        },
        customer_email: invoice.billingContactEmail ?? undefined,
        success_url: `${frontendBaseUrl}/billing/${invoice.id}?paid=1`,
        cancel_url: `${frontendBaseUrl}/billing/${invoice.id}?canceled=1`,
      });

      return res.json({ url: session.url });
    } catch (err) {
      console.error("Error creating Stripe Checkout Session:", err);
      return res
        .status(500)
        .json({ error: "Failed to create Stripe Checkout Session" });
    }
  }
);

export async function stripeWebhookHandler(req: Request, res: Response) {
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return res.status(500).send("Stripe webhook not configured");
  }

  const sig = req.headers["stripe-signature"] as string | undefined;

  if (!sig) {
    console.error("Missing Stripe signature header");
    return res.status(400).send("Missing stripe-signature header");
  }

  let event: Stripe.Event;

  try {
    // req.body is a raw Buffer because we will use express.raw() for this route
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error("⚠️ Stripe webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const invoiceId = session.metadata?.invoiceId;
        const orgId = session.metadata?.orgId;

        if (!invoiceId || !orgId) {
          console.error(
            "checkout.session.completed missing invoiceId or orgId in metadata"
          );
          break;
        }

        // amount_total is in cents
        const amountTotal = session.amount_total ?? 0;
        const amount = amountTotal / 100;

        // Create a Payment record and update invoice (similar to /mark-paid)
        await handleStripeInvoicePayment(invoiceId, orgId, amount);

        break;
      }

      // You could handle other event types here (refunds, etc.)
      default:
        break;
    }

    // Always respond 200 to Stripe to indicate we processed the event
    res.json({ received: true });
  } catch (err) {
    console.error("Error handling Stripe webhook event:", err);
    res.status(500).send("Webhook handler error");
  }
}

/**
 * Helper: record Stripe payment for invoice and update invoice status/balance.
 */
async function handleStripeInvoicePayment(
  invoiceId: string,
  orgId: string,
  amount: number
) {
  // Fetch invoice with existing payments
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      orgId,
    },
    include: {
      payments: true,
    },
  });

  if (!invoice) {
    console.error("Invoice not found in Stripe webhook handler:", invoiceId);
    return;
  }

  // Create payment
  const payment = await prisma.payment.create({
    data: {
      orgId,
      invoiceId: invoice.id,
      status: "completed",
      amount,
      method: "stripe_card", // or "stripe_online"
      paidAt: new Date(),
    },
  });

  // Recalculate totalPaid from all completed payments
  const completedPayments = [
    ...(invoice.payments ?? []),
    payment,
  ].filter((p) => p.status === "completed");

  const totalPaid = completedPayments.reduce(
    (sum, p) => sum + (p.amount || 0),
    0
  );

  const remaining = (invoice.totalAmount || 0) - totalPaid;

  let updatedStatus = invoice.status;
  let paidAt = invoice.paidAt;

  if (remaining <= 0) {
    updatedStatus = "paid";
    if (!paidAt) {
      paidAt = new Date();
    }
  } else if (updatedStatus === "draft") {
    // If it was draft, you might want to bump to "sent" or keep as-is.
    updatedStatus = "sent";
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: updatedStatus,
      paidAt,
    },
  });
}

// existing default export remains:
export default router;
