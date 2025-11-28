import fetch from "node-fetch";
import { supabase } from "../../config/supbase.js";

// 📌 Trigger → Backend
export const onOrderCreated = async (req, res) => {
     try {
          const { order_id, v_id } = req.body;

          if (!order_id || !v_id) {
               return res.status(400).json({ error: "order_id or v_id missing" });
          }

          // 1️⃣ Fetch Order
          const { data: order, error: orderErr } = await supabase
               .from("orders")
               .select("*")
               .eq("order_id", order_id)
               .single();

          if (orderErr) throw orderErr;

          // 2️⃣ Fetch Vendor (vendor_request)
          const { data: vendor, error: vendorErr } = await supabase
               .from("vendor_request")
               .select("*")
               .eq("v_id", v_id)
               .single();

          if (vendorErr) throw vendorErr;

          // 3️⃣ Fetch User
          const { data: user, error: userErr } = await supabase
               .from("user")
               .select("name")
               .eq("user_id", order.u_id)
               .single();

          if (userErr) throw userErr;

          // 4️⃣ Fetch Items (order_items)
          // 4️⃣ Fetch Items (order_item)
          const { data: orderItems, error: itemsErr } = await supabase
               .from("order_item")
               .select("item_id, quantity, final_price")
               .eq("order_id", order_id);

          if (itemsErr) throw itemsErr;

          // 4.1️⃣ Get all item_ids
          const itemIds = orderItems.map(i => i.item_id);

          // 4.2️⃣ Fetch item details from item table
          const { data: items, error: itemsDetailErr } = await supabase
               .from("item")
               .select("item_id, item_name")   // yaha tumhare columns ka exact naam
               .in("item_id", itemIds);

          if (itemsDetailErr) throw itemsDetailErr;

          // 5️⃣ Format items for WhatsApp
          let itemList = "";
          orderItems.forEach((oi, idx) => {
               const item = items.find(it => it.item_id === oi.item_id);
               itemList += `${idx + 1}. ${item?.item_name || "Item"} x ${oi.quantity} = ₹${oi.total_price}\n`;
          });


          const messageText = `🍽 *New Order Received!*\n\n` +
               `*Order ID:* ${order_id}\n` +
               `*Customer:* ${user.name}\n\n` +
               `*Items:*\n${itemList}\n` +
               `*Total Amount:* ₹${order.total_amount}\n\n` +
               `Click below to *ACCEPT* this order.`;


          // 6️⃣ Send WhatsApp Message with Button
          const toNumber = vendor.mobile_number.replace(/\D/g, ""); // sirf digits rakhenga
          const whatsappRes = await sendWhatsappButton(
               toNumber
          );

          console.log("WhatsApp API Response =>", whatsappRes);

          return res.status(200).json({ message: "WhatsApp sent", whatsappRes });

     } catch (err) {
          console.error(err);
          return res.status(500).json({ error: err.message });
     }
};

// 📌 Send Template / Button Message
async function sendWhatsappButton(to) {
     const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

     const jsonBody = {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
               name: "hello_world",          // dashboard wala approved template name
               language: { code: "en_US" }
          }
     };

     const res = await fetch(url, {
          method: "POST",
          headers: {
               Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
               "Content-Type": "application/json",
          },
          body: JSON.stringify(jsonBody),
     });

     return res.json();
}

