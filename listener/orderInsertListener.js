import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { onOrderCreated } from "../controllers/orderController/orderController.js";

dotenv.config();

const supabaseRealtime = createClient(
     process.env.SUPABASE_URL,
     process.env.SUPABASE_SERVICE_ROLE_KEY,
     {
          realtime: {
               params: { eventsPerSecond: 10 },
          },
          auth: {
               autoRefreshToken: false,
               persistSession: false,
          },
     }
);

// 🔒 MEMORY LOCK (per order once)
const processedOrders = new Set();

export function startOrderInsertListener() {
     supabaseRealtime
          .channel("orders-status-placed-channel")
          .on(
               "postgres_changes",
               {
                    event: "UPDATE",
                    schema: "public",
                    table: "orders",
               },
               async (payload) => {
                    const orderId = payload.new?.order_id;
                    const oldStatus = payload.old?.status;
                    const newStatus = payload.new?.status;

                    if (oldStatus !== "Placed" || newStatus !== "Placed") return;

                    // ✅ HARD GUARANTEE: ek order sirf ek baar
                    if (processedOrders.has(orderId)) {
                         console.log("🔕 Already processed order", orderId);
                         return;
                    }

                    processedOrders.add(orderId);

                    console.log("🟢 Processing order once:", orderId);

                    await onOrderCreated(
                         {
                              body: {
                                   order_id: orderId,
                                   v_id: payload.new.v_id,
                                   user_order_id: payload.new.user_order_id,
                              },
                         },
                         {
                              status: () => ({ json: () => { } }),
                         }
                    );
               }
          )
          .subscribe((status) => {
               console.log("Realtime subscription status:", status);
          });
}
