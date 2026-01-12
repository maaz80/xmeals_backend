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
               const { data, error: placeError } = await supabase.rpc(
                    "verify_payment",
                    orderPayload
               );
               // if (data?.status === 'already_failed' && data.refund_amount > 0) {
               //      console.log("💰 Refund required for order:", data.order_id);

               //      const refund = await razorpay.payments.refund(data.payment_id, {
               //           amount: data.refund_amount,
               //           refund_to_source: true
               //      });

               //      console.log("✅ Refund processed from webhook:", refund);
               // }

               if (placeError) {
                    console.error("❌ Order finalize RPC failed from webhook:", placeError.message);
                    return res.status(500).json({ success: false });
               }

               const orderData = Array.isArray(data) ? data[0] : data;
               // STEP E: HANDLE BUSINESS LOGIC RESPONSES FROM THE FUNCTION
               if (orderData) {
                    console.log("RPC Data from webhook:", orderData);
                    console.log('Order status changed to Placed for order ID webhook:', orderData.order_id);

                    switch (orderData.status) {

                         // ✅ SUCCESS
                         case "success":
                              return res.status(200).json({
                                   status: "success",
                                   order_id: orderData.order_id
                              });

                         // 🔁 ALREADY PROCESSED
                         case "already_processed":
                              return res.status(200).json({
                                   status: "already_processed",
                                   order_id: orderData.order_id
                              });

                         // 🔁 ALREADY FAILED (refund flow)
                         case "already_failed":
                              return res.status(409).json({
                                   status: "already_failed",
                                   message: orderData.message,
                                   order_id: orderData.order_id,
                                   refund_amount: orderData.refund_amount
                              });

                         // 🏪 VENDOR NOT FOUND
                         case "vendor_not_found":
                              return res.status(404).json({
                                   status: "vendor_not_found",
                                   message: orderData.message
                              });

                         // 🏪 VENDOR UNAVAILABLE
                         case "vendor_unavailable":
                              return res.status(409).json({
                                   status: "vendor_unavailable",
                                   message: orderData.message
                              });

                         // 📍 ADDRESS NOT FOUND
                         case "address_not_found":
                              return res.status(404).json({
                                   status: "address_not_found",
                                   message: orderData.message
                              });

                         // 🚫 ITEM NOT FOUND
                         case "item_not_found":
                              return res.status(409).json({
                                   status: "item_not_found",
                                   message: orderData.message,
                                   unavailable_items: orderData.unavailable_items
                              });

                         // 🚫 ITEM DEACTIVATED
                         case "item_deactivated":
                              return res.status(409).json({
                                   status: "item_deactivated",
                                   message: orderData.message,
                                   deactivated_items: orderData.deactivated_items
                              });

                         // 🔄 PRICE CHANGED
                         case "price_changed":
                              return res.status(409).json({
                                   status: "price_change",
                                   message: orderData.message,
                                   changed_items: orderData.changed_items
                              });

                         // 💸 MIN ORDER FAIL
                         case "min_order_fail":
                              return res.status(400).json({
                                   status: "min_order_fail",
                                   message: orderData.message
                              });

                         // 💳 PAYMENT FAILED
                         case "payment_failed":
                              return res.status(402).json({
                                   status: "payment_failed",
                                   reason: orderData.reason,
                                   order_id: orderData.order_id,
                                   expected_amount: orderData.expected_amount,
                                   paid_amount: orderData.paid_amount,
                                   difference_paise: orderData.difference_paise
                              });

                         // ❌ SAFETY NET
                         default:
                              console.error("❌ Unknown verify_payment RPC response:", orderData);
                              return res.status(500).json({
                                   status: "unknown_error",
                                   message: "Unexpected response from payment verification."
                              });
                    }

               }


               console.log("✅ Order finalized from webhook:", txnPayload.p_order_id);
          }


          return res.status(200).json({ success: true });

     } catch (err) {
          console.error("🔥 Webhook crash:", err);
          return res.status(500).json({ success: false });
     }
};
