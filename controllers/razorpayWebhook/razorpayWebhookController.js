import crypto from "crypto";
import { supabase } from "../../config/supbase.js"; // Typo fixed: supabase.js

export const razorpayWebhook = async (req, res) => {
     try {
          const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
          const receivedSignature = req.headers["x-razorpay-signature"];

          // 1. SECURITY: Signature Verification
          // Ensure req.body is a Buffer (standard for raw webhook handling)
          const expectedSignature = crypto
               .createHmac("sha256", webhookSecret)
               .update(req.body)
               .digest("hex");

          if (receivedSignature !== expectedSignature) {
               console.error("❌ Invalid Signature: Potential Attack");
               // ⛔ 400: REJECT PERMANENTLY (Don't retry attacks)
               return res.status(400).json({ success: false });
          }

          // 2. PARSE EVENT
          const data = JSON.parse(req.body.toString());
          const event = data.event;
          console.log(`⚡ Webhook Event Received: ${event}`);

          let rpcPayload = null;

          // 3. EVENT ROUTING LOGIC
          switch (event) {
               // ✅ CASE A: The Success Event (Process This)
               case "order.paid": {
                    const o = data.payload.order.entity;
                    const p = data.payload.payment.entity;

                    rpcPayload = {
                         p_order_id: o.id,   // Razorpay ID (order_xyz)
                         p_transaction_id: p.id,      // Payment ID (pay_xyz)
                         p_order_status: "order.paid",
                    };
                    break;
               }

               // ✅ CASE B: The Failure Event (Process This)
               case "payment.failed": {
                    const p = data.payload.payment.entity;

                    rpcPayload = {
                         p_order_id: p.order_id,
                         p_transaction_id: p.id,
                         p_order_status: "payment.failed",
                    };
                    break;
               }

               // 🛑 CASE C: The "Noise" Event (Explicitly Ignore)
               case "payment.captured": {
                    // We ignore this because 'order.paid' covers the full success logic.
                    // If we process both, we might get double notifications.
                    console.log("ℹ️ Ignoring payment.captured (Waiting for order.paid)" , p_order_id);
                    // ✅ 200 OK: Tells Razorpay "Got it, stop sending this."
                    return res.status(200).json({ success: true });
               }

               // 🛑 CASE D: Unknown Events (Safely Ignore)
               default: {
                    console.warn(`🔸 Unhandled Event: ${event}`);
                    // ✅ 200 OK: Prevents Razorpay from spamming retries for events we don't code for.
                    return res.status(200).json({ success: true });
               }
          }

          // 4. DATABASE UPDATE (Atomic RPC)
          // If logic reached here, rpcPayload is guaranteed to be set
          const { error } = await supabase.rpc(
               "razorpay_transaction_record_rpc",
               rpcPayload
          );

          if (error) {
               console.error("RPC Error: Order ID", rpcPayload.p_order_id , error.message );
               return res.status(500).end(); // 👈 MUST
          }

          console.log("✅ Order Processed Successfully" , rpcPayload.p_order_id);
          return res.status(200).json({ success: true });

     } catch (err) {
          console.error("🔥 Webhook Crash:", err);
          // 🔁 500: Server crashed, please retry later
          return res.status(500).json({ success: false });
     }
};