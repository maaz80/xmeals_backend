// orderTimeWorker.js
import cron from "node-cron";
import { supabase } from "../../config/supbase.js";
import { sendWhatsappTemplate } from "./orderController.js";
import { getFullOrderDetails } from "../../services/orderService.js";

// har 1 minute me chalega
cron.schedule("*/1 * * * *", async () => {
     console.log("[CRON] Checking orders for start-preparing reminder...");

     const { data: orders, error } = await supabase
          .from("orders")
          .select("*")
          .eq("status", "accepted"); // sirf accepted

     if (error) {
          console.error("fetch orders error", error);
          return;
     }

     const now = new Date();

     for (const o of orders) {
          if (!o.accepted_ts || !o.max_preparation_time) continue;

          const createdTs = new Date(o.created_ts);
          const etaTs = new Date(o.eta);
          const acceptedTs = new Date(o.accepted_ts);

          const totalTime = etaTs - createdTs;
          const timePassed = now - createdTs;
          const remainingTime = etaTs - now;
          const travelTimeInMs = Number(o.travel_time || 0) * 60 * 1000;

          const percentagePassed =
               totalTime > 0 ? (timePassed / totalTime) * 100 : 100;

          const maxPrepMs = Number(o.max_preparation_time || 0) * 60 * 1000;
          const prepTimePassed =
               now >= new Date(acceptedTs.getTime() + maxPrepMs);

          const dpAssigned = !!o.dp_id;

          // ✅ Same rule + extra: max_preparation_time cross ho chuka ho
          const allow =
               prepTimePassed &&
               (dpAssigned ||
                    percentagePassed >= 65 ||
                    remainingTime <= travelTimeInMs);

          if (!allow) continue;

          console.log("[CRON] Sending start-preparing reminder for", o.order_id);

          const order_id = o.order_id;

          // 1️⃣ Full order details (order, vendor, user, itemsText)
          const { order, vendor, user, itemsText } =  await getFullOrderDetails(order_id);

          const to = vendor.mobile_number.replace(/\D/g, "");

          // 2️⃣ Start Preparing template
          await sendWhatsappTemplate({
               to,
               templateName: "order_preparing", // WhatsApp template name
               bodyParams: [
                    { type: "text", text: order.order_id },             // {{1}}
                    { type: "text", text: String(order.total_amount) }, // {{2}}
                    { type: "text", text: user.name },                  // {{3}}
                    { type: "text", text: itemsText },                  // {{4}}
               ],
               buttonPayload: `START_PREPARING:${order.order_id}`,
          });

          // 3️⃣ Dobara na bhejne ke liye status change
          await supabase
               .from("orders")
               .update({ status: "temp_preparing" })
               .eq("order_id", order.order_id);
     }
});
