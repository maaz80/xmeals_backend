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
          const { data: items, error: itemsErr } = await supabase
               .from("order_item")
               .select("*")
               .eq("order_id", order_id);

          if (itemsErr) throw itemsErr;

          // 5️⃣ Format items for WhatsApp
          let itemList = "";
          items.forEach((item, idx) => {
               itemList += `${idx + 1}. ${item.item_name} x ${item.quantity} = ₹${item.total_price}\n`;
          });

          const messageText = `🍽 *New Order Received!*\n\n` +
               `*Order ID:* ${order_id}\n` +
               `*Customer:* ${user.name}\n\n` +
               `*Items:*\n${itemList}\n` +
               `*Total Amount:* ₹${order.total_amount}\n\n` +
               `Click below to *ACCEPT* this order.`;


          // 6️⃣ Send WhatsApp Message with Button
          const whatsappRes = await sendWhatsappButton(
               vendor.vendor_whatsapp_number,
               messageText,
               `ACCEPT_ORDER:${order_id}`
          );

          console.log("WhatsApp API Response =>", whatsappRes);

          return res.status(200).json({ message: "WhatsApp sent", whatsappRes });

     } catch (err) {
          console.error(err);
          return res.status(500).json({ error: err.message });
     }
};

// 📌 Send Template / Button Message
async function sendWhatsappButton(to, bodyText, payload) {
     const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

     const jsonBody = {
          messaging_product: "whatsapp",
          to,
          type: "interactive",
          interactive: {
               type: "button",
               body: { text: bodyText },
               action: {
                    buttons: [
                         {
                              type: "reply",
                              reply: {
                                   id: payload,
                                   title: "ACCEPT"
                              }
                         }
                    ]
               }
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
