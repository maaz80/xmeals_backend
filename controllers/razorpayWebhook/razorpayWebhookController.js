import crypto from "crypto";

export const razorpayWebhook = (req, res) => {
     const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

     const shasum = crypto.createHmac("sha256", webhookSecret);
     shasum.update(JSON.stringify(req.body));
     const digest = shasum.digest("hex");

     if (digest !== req.headers["x-razorpay-signature"]) {
          return res.status(400).json({ success: false, message: "Invalid signature" });
     }

     const event = req.body.event;
     console.log("🔥 Webhook HIT hua at:", new Date().toISOString());
     console.log("✅ Signature Verified");

     const data = JSON.parse(req.body.toString());

     console.log("EVENT:", data.event);
     console.log("🔥 HEADERS:", req.headers);

     switch (event) {

          case "payment.captured": {
               const payment = req.body.payload.payment.entity;

               console.log("💚 Payment Captured (Success):", payment.id);

               // Payment success logic
               // update order -> PAID
               break;
          }

          case "payment.failed": {
               const payment = req.body.payload.payment.entity;

               console.log("❌ Payment Failed:", payment.id);

               // Payment failed logic
               // update order -> FAILED
               break;
          }

          case "payment.authorized": {
               console.log("⚠️ Payment Authorized (But not captured)");
               break;
          }

          case "order.paid": {
               console.log("🟦 Order Fully Paid Event");
               break;
          }

          default:
               console.log("Unhandled event:", event);
     }

     return res.json({ success: true });
};
