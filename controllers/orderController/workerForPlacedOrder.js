// orderTimeWorker.js
import cron from "node-cron";
import { supabase } from "../../config/supbase.js";
import { onOrderCreated } from "./orderController.js";

// har 1 minute me chalega
cron.schedule("*/1 * * * *", async () => {
     console.log("[CRON] Checking orders for sending first message...");

     const { data: orders, error } = await supabase
          .from("orders")
          .select("*")
          .eq("status", "Placed") // sirf Placed
          .is("wa_message_id", null)
          .limit(20);

     if (error) {
          console.error("fetch orders error", error);
          return;
     }

     console.log("🟢 Status → PLACED");

     for (const order of orders) {
          try {

               console.log("🟢 Sending first WhatsApp for order:", order.order_id);

               // 3️⃣ Send WhatsApp (reuse existing controller)
               await onOrderCreated(
                    {
                         body: {
                              order_id: order.order_id,
                              v_id: order.v_id,
                              user_order_id: order.user_order_id,
                         },
                    },
                    {
                         status: () => ({ json: () => { } }),
                    }
               );

          
          } catch (err) {
               console.error(
                    "🔥 Error while processing order:",
                    order.order_id,
                    err
               );

          }
     }
});