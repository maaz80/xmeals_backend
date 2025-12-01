// whatsappController.js
import { supabase } from "../../config/supbase.js";
import { assertVendorAuthorized, calculateFinalAmount, getFullOrderDetails, isMessageExpired } from "../../services/orderService.js";
import { sendWhatsappTemplate, sendTextMessage } from "../orderController/orderController.js";

// 📌 GET: Webhook verification
export const verifyWebhook = (req, res) => {
     const mode = req.query["hub.mode"];
     const challenge = req.query["hub.challenge"];
     const token = req.query["hub.verify_token"];

     if (mode && token === process.env.WHATSAPP_VERIFY_TOKEN) {
          return res.status(200).send(challenge);
     }
     return res.sendStatus(403);
};

// 📌 POST: WhatsApp webhook (buttons, messages)
export const whatsappWebhook = async (req, res) => {
     try {
          console.log("RAW WHATSAPP WEBHOOK:", JSON.stringify(req.body, null, 2));
          const data = req.body;
          const message = data?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

          if (!message) return res.sendStatus(200);

          // 1️⃣ Button replies
          if (message.type === "button" && message.button?.payload) {
               const payload = message.button.payload;
               const [action, order_id] = payload.split(":");
               if (!order_id) return res.sendStatus(200);

               // Display ID 
               const { order } = await getFullOrderDetails(order_id);
               const displayOrderId = String(order.user_order_id || "");

               if (action === "ACCEPT_ORDER" || action === "START_PREPARING") {
                    if (isMessageExpired(message, 5)) {
                         await sendTextMessage({
                              to: message.from,
                              text: `⏰ Time limit exceeded for order ${displayOrderId}. Please use the latest WhatsApp message.`,
                         });
                         return res.sendStatus(200);
                    }
               }
              
               const waId = message.from;

               const allowed = await assertVendorAuthorized(order_id, waId);
               if (!allowed) {
                    console.log("Unauthorized WhatsApp user for order", displayOrderId, waId);
                    await sendTextMessage({
                         to: waId,
                         text: "❌ You are not authorized to manage this order. Please contact support or use your registered WhatsApp number.",
                    });
                    return res.sendStatus(403);
               }

               if (action === "ACCEPT_ORDER") {
                    const { error } = await supabase
                         .from("orders")
                         .update({ status: "accepted", accepted_ts: new Date() })
                         .eq("order_id", order_id);

                    if (error) {
                         console.error("ACCEPT_ORDER update error:", error);
                         throw error;
                    }

                    await sendTextMessage({
                         to: message.from,
                         text: `✅ Order ${displayOrderId} accepted successfully!`
                    });
               

               } else if (action === "START_PREPARING") {
                    // ✅ Vendor ne Start Preparing dabaya
                    
                    const { order, vendor, user, itemsText } = await getFullOrderDetails(order_id);
                    const to = vendor.mobile_number.replace(/\D/g, "");
                    const { final_amount } = calculateFinalAmount(order);
                    const displayOrderId = String(order.user_order_id || "");

                    const { error } = await supabase
                         .from("orders")
                         .update({ status: "preparing", preparing_ts: new Date() })
                         .eq("order_id", order_id);

                    if (error) throw error;

                    // ✅ CONFIRMATION MESSAGE
                    await sendTextMessage({
                         to: message.from,
                         text: `✅ Started preparing order ${displayOrderId}`
                    });

                    // Prepared template (jisme Prepared button hai)
                    await sendWhatsappTemplate({
                         to,
                         templateName: "order_prepared",
                         bodyParams: [
                              { type: "text", text: displayOrderId },
                              { type: "text", text: String(final_amount) },
                              { type: "text", text: user.name },
                              { type: "text", text: itemsText },
                         ],
                         buttonPayload: `PREPARED:${order_id}`,
                    });
               } else if (action === "PREPARED") {
                    // ✅ Vendor ne Prepared button dabaya
                    const { order, vendor, user, itemsText } = await getFullOrderDetails(order_id);
                    const to = vendor.mobile_number.replace(/\D/g, "");
                    const { final_amount } = calculateFinalAmount(order);
                    const displayOrderId = String(order.user_order_id || "");

                    const { error } = await supabase
                         .from("orders")
                         .update({ status: "prepared", prepared_ts: new Date() })
                         .eq("order_id", order_id);

                    if (error) throw error;

                    // ✅ CONFIRMATION MESSAGE
                    await sendTextMessage({
                         to: message.from,
                         text: `✅ Order ${displayOrderId} marked as prepared!`
                    });

                    // Hand Over template (button: Hand Over to DP)
                    await sendWhatsappTemplate({
                         to,
                         templateName: "order_hand_over",
                         bodyParams: [
                              { type: "text", text: displayOrderId },
                              { type: "text", text: String(final_amount) },
                              { type: "text", text: user.name },
                              { type: "text", text: itemsText },
                         ],
                         buttonPayload: `HAND_OVER:${order_id}`,
                    });
               } else if (action === "HAND_OVER") {
                    // ✅ HAND_OVER: Existing dp_otp use karo
                    const { order} = await getFullOrderDetails(order_id);
                    const displayOrderId = String(order.user_order_id || "");

                    const { data: orders, error: orderErr } = await supabase
                         .from("orders")
                         .select("dp_otp, v_id")
                         .eq("order_id", order_id)
                         .single();

                    if (orderErr || !orders || !orders.dp_otp) {
                         console.error("Order or DP OTP not found:", orderErr);
                         return res.status(400).json({ error: "DP OTP not available" });
                    }

                    // Status handover_pending karo
                    await supabase
                         .from("orders")
                         .update({ wa_handover_otp_started: true })
                         .eq("order_id", order_id);

                    // Vendor ko OTP mangne wala text bhejo
                    const waId = message.from;
                    await sendTextMessage({
                         to: waId,
                         text: `Enter the 6-digit DP OTP to handover order ${displayOrderId}`,
                    });

                    console.log(`OTP verification started for order ${displayOrderId}, expected: ${order.dp_otp}`);
               }

               return res.status(200).json({ success: true });
          }

          // 2️⃣ Text message handling (OTP verification)
          if (message.type === "text" && message.text?.body) {
               const waId = message.from;
               const enteredOtp = message.text.body.trim();

               // handover_pending order dhundo (latest)
               const { data: pendingOrder, error: orderErr } = await supabase
                    .from("orders")
                    .select("*")
                    .eq("status", "handover_pending")
                    // .eq("order_id", order_id)
                    .order("updated_ts", { ascending: false })
                    .limit(1)
                    .single();

               if (orderErr || !pendingOrder) {
                    return res.sendStatus(200);
               }
               const { order } = await getFullOrderDetails(pendingOrder.order_id);
               const displayOrderId = String(order.user_order_id || "");
               // 🔐 Yahan bhi vendor auth check (same helper)
               const allowed = await assertVendorAuthorized(pendingOrder.order_id, waId);
               if (!allowed) {
                    console.log("Unauthorized WhatsApp user for OTP", displayOrderId, waId);
                    await sendTextMessage({
                         to: waId,
                         text: "❌ You are not authorized to manage this order. Please contact support or use your registered WhatsApp number.",
                    });

                    return res.sendStatus(403);
               }

               // ✅ Existing dp_otp se match karo
               if (parseInt(enteredOtp) === parseInt(pendingOrder.dp_otp)) {

                    // Tumhara existing RPC call
                    const { error: rpcErr } = await supabase
                         .from("orders")
                         .update({
                              status: "on the way",
                              on_the_way_ts: new Date(),
                         })
                         .eq("order_id", pendingOrder.order_id);

                    if (!rpcErr) {
                         await sendTextMessage({
                              to: waId,
                              text: `✅ Order ${displayOrderId} handed over to DP successfully!`
                         });
                    } else {
                         await sendTextMessage({
                              to: waId,
                              text: `❌ Failed to update status. Please try again.`
                         });
                    }
               } else {
                    console.log('OTP MIsmatch' + enteredOtp + pendingOrder.dp_otp);
                    
                    await sendTextMessage({
                         to: waId,
                         text: `❌ Invalid OTP. Try again.`
                    });
               }

               return res.status(200).json({ success: true });
          }

          return res.sendStatus(200);
     } catch (err) {
          console.error("Whatsapp webhook error:", err);
          return res.status(500).json({ error: err.message });
     }
};


