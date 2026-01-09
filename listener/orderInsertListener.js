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
                    const waMessageId = payload.new?.wa_message_id;
                    const isSameStatusUpdate = payload.old?.status === payload.new?.status;
                    // ✅ FINAL CONDITION
                    if (
                         !isSameStatusUpdate &&
                         oldStatus !== "Placed" &&
                         newStatus === "Placed" &&
                         !waMessageId // null / empty
                    ) {
                         console.log("🟢 Status → PLACED & WhatsApp not sent yet");

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