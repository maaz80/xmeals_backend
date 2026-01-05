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

          // ❌ INVALID SIGNATURE → NO RETRY (security issue)
          if (receivedSignature !== expectedSignature) {
               console.log("❌ Invalid signature");
               return res.status(400).json({ success: false });
          }

          console.log("🔥 Webhook HIT:", new Date().toISOString());

          const data = JSON.parse(req.body.toString());
          const event = data.event;

          console.log("EVENT:", event);

          let rpcPayload = null;

          // 🎯 Decide payload only (NO DB CALL YET)
          switch (event) {

               case "payment.failed": {
                    const p = data.payload.payment.entity;
                    rpcPayload = {
                         p_order_id: p.order_id,
                         p_transaction_id: p.id,
                         p_order_status: "payment.failed",
                    };
                    break;
               }

               case "order.paid": {
                    const o = data.payload.order.entity;
                    const p = data.payload.payment.entity;
                    rpcPayload = {
                         p_order_id: o.id,
                         p_transaction_id: p.id,
                         p_order_status: "order.paid",
                    };
                    break;
               }

               default:
                    console.log("🔸 Ignored Event:", event);
                    // ⚠️ Unknown event → ACK so Razorpay doesn't retry
                    return res.status(400).json({ success: false });
          }

          // ❌ SAFETY CHECK
          if (!rpcPayload) {
               return res.status(400).json({ success: false });
          }

          // 🚨 SINGLE DB CALL POINT
          const { error } = await supabase.rpc(
               "razorpay_transaction_record_rpc",
               rpcPayload
          );

          if (error) {
               console.error("⚠️ RPC FAILED → RETRY NEEDED", error);
               return res.status(500).json({ success: false }); // 🔁 Razorpay retry
          }

          // ✅ SUCCESS → STOP RETRY
          console.log("✅ Webhook processed successfully");
          return res.status(200).json({ success: true });

     } catch (err) {
          console.error("❌ Webhook crashed:", err);
          return res.status(500).json({ success: false }); // 🔁 Retry
     }
};
