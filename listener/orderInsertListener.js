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

export function startOrderInsertListener() {
     supabaseRealtime
          .channel("orders-placed-channel")
          .on(
               "postgres_changes",
               {
                    event: "INSERT",
                    schema: "public",
                    table: "orders",
               },
               async (payload) => {
                    // Case 1: Order inserted directly as Placed
                    if (payload.new.status === "Placed") {
                         console.log("🟢 Order INSERT with Placed:", payload.new);

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
          .on(
               "postgres_changes",
               {
                    event: "UPDATE",
                    schema: "public",
                    table: "orders",
               },
               async (payload) => {
                    // Case 2: Status transition Pending → Placed
                    if (
                         payload.old?.status !== "Placed" &&
                         payload.new?.status === "Placed"
                    ) {
                         console.log("🟡 Order UPDATE to Placed:", payload.new);

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
