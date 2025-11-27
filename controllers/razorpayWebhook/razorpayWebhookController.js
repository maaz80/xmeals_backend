import crypto from "crypto";
import { supabase } from "../../config/supbase.js";

export const razorpayWebhook = async (req, res) => {
     try {
          const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
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

          const data = JSON.parse(req.body.toString());
          const event = data.event;

          console.log("EVENT:", event);

          try {
               switch (event) {
                    case "payment.captured": {
                         const payment = data.payload.payment.entity;
                         const paymentId = payment.id;
                         const orderId = payment.order_id;

                         console.log("💚 Payment Captured:", paymentId, "Order:", orderId);

                         const { error } = await supabase.rpc(
                              "razorpay_transaction_record_rpc",
                              {
                                   p_order_id: orderId,
                                   p_transaction_id: paymentId,
                                   p_order_status: "payment.captured",
                              }
                         );

                         if (error) {
                              console.error("RPC error (captured):", error);
                         }

                         break;
                    }

                    case "payment.failed": {
                         const payment = data.payload.payment.entity;
                         const paymentId = payment.id;
                         const orderId = payment.order_id;

                         console.log("❌ Payment Failed:", paymentId, "Order:", orderId);

                         const { error } = await supabase.rpc(
                              "razorpay_transaction_record_rpc",
                              {
                                   p_order_id: orderId,
                                   p_transaction_id: paymentId,
                                   p_order_status: "payment.failed",
                              }
                         );

                         if (error) {
                              console.error("RPC error (failed):", error);
                         }

                         break;
                    }

                    case "payment.authorized": {
                         const payment = data.payload.payment.entity;
                         const paymentId = payment.id;
                         const orderId = payment.order_id;

                         console.log("⚠️ Payment Authorized:", paymentId, "Order:", orderId);

                         const { error } = await supabase.rpc(
                              "razorpay_transaction_record_rpc",
                              {
                                   p_order_id: orderId,
                                   p_transaction_id: paymentId,
                                   p_order_status: "payment.authorized",
                              }
                         );

                         if (error) {
                              console.error("RPC error (authorized):", error);
                         }

                         break;
                    }

                    case "order.paid": {
                         const order = data.payload.order.entity;
                         const payment = data.payload.payment.entity;
                         const orderId = order.id;
                         const paymentId = payment.id;

                         console.log("🟦 Order Paid:", orderId, "Payment:", paymentId);

                         const { error } = await supabase.rpc(
                              "razorpay_transaction_record_rpc",
                              {
                                   p_order_id: orderId,
                                   p_transaction_id: paymentId,
                                   p_order_status: "order.paid",
                              }
                         );

                         if (error) {
                              console.error("RPC error (order.paid):", error);
                         }

                         break;
                    }

                    default:
                         console.log("🔸 Unhandled Event:", event);
               }
          } catch (innerErr) {
               // JSON structure / RPC call me koi unexpected crash
               console.error("Inner webhook handler error:", innerErr);
          }

          // Razorpay ko hamesha 200/ok dena (warna woh retry spam karega)
          return res.json({ success: true });
     } catch (outerErr) {
          console.error("Webhook outer error:", outerErr);
          // yahan bhi ideally 200 hi do, but log zarur karo
          return res.json({ success: true });
     }
};
