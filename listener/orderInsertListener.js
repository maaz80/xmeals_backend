import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { onOrderCreated } from "../controllers/orderController/orderController.js";

dotenv.config();

const supabaseRealtime = createClient(
     process.env.SUPABASE_URL,
     process.env.SUPABASE_SERVICE_ROLE_KEY,
     {
          realtime: {
               params: {
                    eventsPerSecond: 10,
               },
          },
          auth: {
               autoRefreshToken: false,
               persistSession: false,
          },
     }
);

export function startOrderPlacedListener() {
     supabaseRealtime
          .channel("orders-placed-channel")
          .on(
               "postgres_changes",
               {
                    event: "*", // Listen to both INSERT and UPDATE
                    schema: "public",
                    table: "orders",
               },
               async (payload) => {
                    // ✅ Run only if new status is 'Placed'
                    if (payload.new?.status === "Placed") {
                         console.log("🟢 Order with Placed status:", payload.new);

                         await onOrderCreated(
                              {
                                   body: {
                                        order_id: payload.new.order_id,
                                        v_id: payload.new.v_id,
                                        user_order_id: payload.new.user_order_id,
                                   },
                              },
                              {
                                   status: () => ({ json: () => { } }),
                              }
                         );
                    }
               }
          )
          .subscribe((status) => {
               console.log("Realtime subscription status:", status);
          });
}
