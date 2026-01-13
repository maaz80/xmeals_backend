import crypto from "crypto";
import { supabase } from "../../config/supbase.js";
import { finalizePaymentWithRetry } from "../../services/verifyPayment.core.js";

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
          const cuspayload = JSON.parse(req.body.toString());
          const event = cuspayload.event;

          console.log("⚡ Razorpay event:", event);

          let txnPayload = null;
          let orderPayload = null;
          let shouldFinalizeOrder = false;

          /* ---------------- Event Routing ---------------- */
          switch (event) {
               case "order.paid": {
                    const order = cuspayload?.payload?.order?.entity;
                    const payment = cuspayload?.payload?.payment?.entity;
                    const internalOrderId = payment?.notes?.internal_order_id;
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

                    const { data: orderItems } = await supabase
                         .from('order_item')
                         .select('item_id, quantity, final_price')
                         .eq('order_id', internalOrderId);

                    if (!orderItems || orderItems.length === 0) {
                         console.error("❌ No order_items found for order:", internalOrderId);
                         return res.status(400).json({ success: false });
                    }

                    const cartItemsForRpc = orderItems.map(oi => ({
                         item_id: oi.item_id,
                         quantity: oi.quantity,
                         client_price: oi.final_price
                    }));


                    if (orderData.payment_gateway_order_id !== order.id) {
                         console.error("❌ Razorpay order ID mismatch", {
                              db: orderData.payment_gateway_order_id,
                              webhook: order.id
                         });
                         return res.status(400).json({ success: false });
                    }

                    orderPayload = {
                         p_order_id: internalOrderId,
                         p_payment_type: 'online',
                         p_payment_id: payment.id,
                         p_razorpay_order_id: order.id,
                         p_paid_amount: payment.amount,
                         p_user_id: orderData.u_id,
                         p_address_id: orderData.addr_id,
                         p_cart_vendor_id: orderData.v_id,
                         p_cart_items: cartItemsForRpc,
                         p_tax_collected: orderData.tax_collected,

                    };

                    txnPayload = {
                         p_order_id: order.id,
                         p_transaction_id: payment.id,
                         p_order_status: "order.paid",
                    };

                    shouldFinalizeOrder = true;
                    break;
               }

               case "payment.failed": {
                    const payment = cuspayload?.payload?.payment?.entity;
                    const order = cuspayload?.payload?.order?.entity;
                    txnPayload = {
                         p_order_id: order.id,
                         p_transaction_id: payment.id,
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
          if (!txnError) {
               console.log("✅ Transaction recorded from webhook:", txnPayload.p_transaction_id);
          }
          /* ---------------- FINALIZE ORDER (ONLY order.paid) ---------------- */
          if (shouldFinalizeOrder) {
               const { data, error } = await verifyPaymentWithRetry({
                    supabase,
                    rpcParams: orderPayload
               });

               if (error) {
                    const isTimeout =
                         error.code === "57014" ||
                         error.message?.includes("timeout");

                    if (isTimeout) {
                         return res.status(500).json({ success: false });
                    }

                    return res.status(200).json({ success: true });
               }
          }

          // const orderData = Array.isArray(data) ? data[0] : data;

          // if (
          //      orderData?.status === "success" ||
          //      orderData?.status === "already_processed"
          // ) {
          //      console.log("✅ Order finalized:", orderData.order_id);
          //      return res.status(200).json({ success: true });
          // }

          // if (data?.status === 'already_failed' && data.refund_amount > 0) {
          //      console.log("💰 Refund required for order:", data.order_id);

          //      const refund = await razorpay.payments.refund(data.payment_id, {
          //           amount: data.refund_amount,
          //           refund_to_source: true
          //      });

          //      console.log("✅ Refund processed from webhook:", refund);
          // }


          return res.status(200).json({ success: true });

     } catch (err) {
          console.error("🔥 Webhook crash:", err);
          return res.status(500).json({ success: false });
     }
};
