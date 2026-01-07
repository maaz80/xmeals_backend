import crypto from "crypto";
import { supabase } from "../../config/supbase.js";

export const razorpayWebhook = async (req, res) => {
     try {
          /* ---------------- Signature Verify ---------------- */
          const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
          const signature = req.headers["x-razorpay-signature"];

          const expected = crypto
               .createHmac("sha256", secret)
               .update(req.body)
               .digest("hex");

          if (signature !== expected) {
               console.error("❌ Invalid Razorpay signature");
               return res.status(400).json({ success: false });
          }

          /* ---------------- Parse Event ---------------- */
          const payload = JSON.parse(req.body.toString());
          const event = payload.event;

          console.log("⚡ Razorpay event:", event);

          let txnPayload = null;
          let orderPayload = null;
          let shouldFinalizeOrder = false;

          /* ---------------- Event Routing ---------------- */
          switch (event) {
               case "order.paid": {
                    const order = payload.payload.order.entity;
                    const payment = payload.payload.payment.entity;
                    const orderPayloadJson = payment.notes?.orderPayload;
                    const internalOrderId = payment.notes?.internal_order_id;
                    if (!internalOrderId) {
                         console.error("❌ internal_order_id missing");
                         return res.status(400).json({ success: false });
                    }

                    // fetch order + cart + vendor details from DB
                    const { data: orderData } = await supabase
                         .from('orders')
                         .select('*')
                         .eq('order_id', internalOrderId)
                         .single();

                    const { data: cartItems } = await supabase
                         .from('user_cart')
                         .select('*')
                         .eq('u_id', orderData.u_id)
                         .eq('vendor_id', orderData.v_id);

                    orderPayload = {
                         p_order_id: internalOrderId,
                         p_payment_type: 'online',
                         p_payment_id: payment.id,
                         p_razorpay_order_id: order.id,
                         p_paid_amount: payment.amount / 100,
                         p_user_id: orderData.u_id,
                         p_address_id: orderData.addr_id,
                         p_cart_vendor_id: orderData.v_id,
                         p_cart_items: JSON.stringify(cartItems),
                         p_tax_collected: orderData.tax_collected,

                    };

                    txnPayload = {
                         p_razorpay_order_id: order.id,
                         p_payment_id: payment.id,
                         p_order_status: "order.paid",
                    };

                    shouldFinalizeOrder = true;
                    break;
               }

               case "payment.failed": {
                    const payment = payload.payload.payment.entity;
                    const order = payload.payload.order.entity;
                    txnPayload = {
                         p_razorpay_order_id: order.id,
                         p_payment_id: payment.id,
                         p_order_status: "payment.failed",
                    };

                    break;
               }

               case "payment.captured": {
                    console.log("ℹ️ Ignoring payment.captured");
                    return res.status(200).json({ success: true });
               }

               default: {
                    console.log("ℹ️ Ignored event:", event);
                    return res.status(200).json({ success: true });
               }
          }

          /* ---------------- TRANSACTION RPC (ALWAYS) ---------------- */
          const { error: txnError } = await supabase.rpc(
               "razorpay_transaction_record_rpc",
               txnPayload
          );

          if (txnError) {
               console.error("❌ Transaction RPC failed:", txnError.message);
               // webhook retry needed
               return res.status(500).json({ success: false });
          }

          /* ---------------- FINALIZE ORDER (ONLY order.paid) ---------------- */
          if (shouldFinalizeOrder) {
               const { data, error: placeError } = await supabase.rpc(
                    "verify_payment",
                    orderPayload
               );
               if (data?.status === 'failed' && data.refund_amount > 0) {
                    console.log("💰 Refund required for order:", data.order_id);

                    const refund = await razorpay.payments.refund(data.payment_id, {
                         amount: data.refund_amount * 100,
                         refund_to_source: true
                    });

                    console.log("✅ Refund processed from webhook:", refund);
               }

               if (placeError) {
                    console.error("❌ Order finalize RPC failed:", placeError.message);
                    return res.status(500).json({ success: false });
               }

               console.log("✅ Order finalized:", txnPayload.p_order_id);
          }

          return res.status(200).json({ success: true });

     } catch (err) {
          console.error("🔥 Webhook crash:", err);
          return res.status(500).json({ success: false });
     }
};
