import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { onOrderCreated } from "../controllers/orderController/orderController.js";
import { supabase } from "../config/supbase.js";

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
          .channel("orders-status-placed-channel")
          .on(
               "postgres_changes",
               {
                    event: "UPDATE",
                    schema: "public",
                    table: "orders",
               },
               async (payload) => {
                    const oldStatus = payload.old?.status;
                    const newStatus = payload.new?.status;

                    if (oldStatus !== "Placed" || newStatus !== "Placed") return;

                    const { data: lockedOrder } = await supabase
                         .from("orders")
                         .update({ wa_message_id: "__LOCK__" })
                         .eq("order_id", payload.new.order_id)
                         .is("wa_message_id", null)
                         .select()
                         .single();

                    if (!lockedOrder) {
                         console.log("🔕 WhatsApp already locked/sent for order", payload.new.order_id);
                         return;
                    }

                    console.log("🟢 LOCK ACQUIRED → sending WhatsApp");

                    await onOrderCreated(
                         {
                              body: {
                                   order_id: lockedOrder.order_id,
                                   v_id: lockedOrder.v_id,
                                   user_order_id: lockedOrder.user_order_id,
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