import crypto from "crypto";

export const razorpayWebhook = (req, res) => {
     const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

     // 🔥 RAW BODY REQUIRED
     const receivedSignature = req.headers["x-razorpay-signature"];

     const expectedSignature = crypto
          .createHmac("sha256", webhookSecret)
          .update(req.body) // raw buffer
          .digest("hex");

     if (receivedSignature !== expectedSignature) {
          console.log("❌ Invalid signature");
          return res.status(400).json({ success: false });
     }

     console.log("🔥 Webhook HIT at:", new Date().toISOString());
     console.log("⚡ Signature Verified");

     // Ab raw body ko JSON me convert karo
     const data = JSON.parse(req.body.toString());
     const event = data.event;

     console.log("EVENT:", event);

     switch (event) {
          case "payment.captured": {
               const payment = data.payload.payment.entity;
               const paymentId = payment.id;
               const orderId = payment.order_id;  
               console.log("Payment Captured:", paymentId, "Order:", orderId);
               break;
          }

          case "payment.failed":
               console.log("❌ Payment Failed:", data.payload.payment.entity.id);
               break;

          case "payment.authorized":
               console.log("⚠️ Payment Authorized");
               break;

          case "order.paid": {
               const order = data.payload.order.entity;
               const payment = data.payload.payment.entity;
               const orderId = order.id;
               const paymentId = payment.id;
               console.log("Order Paid:", orderId, "Payment:", paymentId);
               break;
          }
          default:
               console.log("🔸 Unhandled Event:", event);
     }

     return res.json({ success: true });
};
