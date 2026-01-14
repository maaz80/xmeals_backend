import crypto from "crypto";
import { supabase } from "../../config/supbase.js";
import { verifyPaymentWithRetry } from "../../services/verifyPaymentWithRetry.service.js";

export const razorpayWebhook = async (req, res) => {
     /* ---------------- 1. Signature Verify (Must be Sync) ---------------- */
     try {
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
     } catch (err) {
          console.error("🔥 Signature Check Failed:", err);
          return res.status(500).json({ success: false });
     }

     /* ---------------- 2. SEND 200 OK IMMEDIATELY ---------------- */
     // Razorpay ko happy kar do taki wo retry na kare
     res.status(200).json({ success: true });

     /* ---------------- 3. Process Logic in Background ---------------- */
     // Hum 'await' nahi karenge jo response ko block kare, balki async function call karenge
     processWebhookInBackground(req.body).catch(err => {
          console.error("🔥 Background Webhook Processing Error:", err);
          // Note: Kyunki humne 200 bhej diya hai, Razorpay retry nahi karega.
          // Agar yahan error aata hai to aapko DB me log karna padega manual check ke liye.
     });
};

// Heavy Logic ko alag function me daal diya
const processWebhookInBackground = async (reqBody) => {
     const cuspayload = JSON.parse(reqBody.toString());
     const event = cuspayload.event;

     console.log("⚡ Razorpay event processing started:", event);

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
                    return;
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
                    return;
               }
               if (orderData.payment_id !== payment.id) {
                    console.error("❌ Payment ID mismatch for order:", internalOrderId);
                    return;
               }
               const cartItemsForRpc = orderItems.map(oi => ({
                    item_id: oi.item_id,
                    quantity: oi.quantity,
                    client_price: oi.final_price
               }));


               // Check for duplicate processing handled by RPC or verifyPayment logic usually
               // But good to check if already paid in DB here if needed

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

          default:
               console.log("ℹ️ Ignored event:", event);
               return;
     }

     /* ---------------- TRANSACTION RPC ---------------- */
     if (txnPayload) {
          const { error: txnError } = await supabase.rpc(
               "razorpay_transaction_record_rpc",
               txnPayload
          );

          if (txnError) {
               console.error("❌ Transaction RPC failed:", txnError.message);
               // Critical: Log this to a separate error_table in DB because Razorpay won't retry
               return;
          }
          console.log("✅ Transaction recorded:", txnPayload.p_transaction_id);
     }

     /* ---------------- FINALIZE ORDER (Long Running Task) ---------------- */
     if (shouldFinalizeOrder) {
          console.log(`🔄 Finalizing order ${orderPayload.p_order_id} in background...`);

          // Yeh function 1 min le sakta hai, koi issue nahi kyunki response ja chuka hai
          const { data, error } = await verifyPaymentWithRetry({
               supabase,
               rpcParams: orderPayload
          });

          if (error) {
               console.error(`❌ Background Finalize Failed for ${orderPayload.p_order_id}:`, error.message);
               // Recommendation: Add logic here to alert Admin (Slack/Email) or add to a 'retry_queue' table
          } else {
               console.log(`✅ Background Finalize Success for ${orderPayload.p_order_id}`);
          }
     }
};