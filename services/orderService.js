// services/orderService.js
import { supabase } from "../config/supbase";

export async function getFullOrderDetails(order_id) {
     // Order
     const { data: order, error: orderErr } = await supabase
          .from("orders")
          .select("*")
          .eq("order_id", order_id)
          .single();
     if (orderErr || !order) throw orderErr || new Error("Order not found");

     // Vendor
     const { data: vendor, error: vendorErr } = await supabase
          .from("vendor_request")
          .select("*")
          .eq("v_id", order.v_id)
          .single();
     if (vendorErr || !vendor) throw vendorErr || new Error("Vendor not found");

     // User
     const { data: user, error: userErr } = await supabase
          .from("user")
          .select("name, mobile_number")
          .eq("user_id", order.u_id)
          .single();
     if (userErr || !user) throw userErr || new Error("User not found");

     // Items
     const { data: orderItems, error: itemsErr } = await supabase
          .from("order_item")
          .select("item_id, quantity, final_price")
          .eq("order_id", order_id);
     if (itemsErr) throw itemsErr;

     const itemIds = orderItems.map((i) => i.item_id);

     const { data: items, error: itemsDetailErr } = await supabase
          .from("item")
          .select("item_id, item_name")
          .in("item_id", itemIds);
     if (itemsDetailErr) throw itemsDetailErr;

     const itemsText = orderItems
          .map((oi) => {
               const it = items.find((x) => x.item_id === oi.item_id);
               const name = it?.item_name || "Item";
               return `${name} x${oi.quantity}`;
          })
          .join(", ");

     return { order, vendor, user, orderItems, items, itemsText };
}
