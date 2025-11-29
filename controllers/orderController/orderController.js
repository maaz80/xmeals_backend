// orderController.js
import fetch from "node-fetch";
import { getFullOrderDetails } from "../../services/orderService.js";

// ✅ Common helper: WhatsApp template send
export async function sendWhatsappTemplate({
     to,
     templateName,
     bodyParams = [],
     buttonPayload,
}) {
     const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

     const jsonBody = {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
               name: templateName,
               language: { code: "en_US" },
               components: [
                    {
                         type: "body",
                         parameters: bodyParams,
                    },
               ],
          },
     };

     if (buttonPayload) {
          jsonBody.template.components.push({
               type: "button",
               sub_type: "quick_reply",
               index: "0",
               parameters: [
                    {
                         type: "payload",
                         payload: buttonPayload,
                    },
               ],
          });
     }

     const res = await fetch(url, {
          method: "POST",
          headers: {
               Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
               "Content-Type": "application/json",
          },
          body: JSON.stringify(jsonBody),
     });

     const json = await res.json();
     console.log("WhatsApp send response =>", json);
     return json;
}

// orderController.js me YE FUNCTION ADD KARO (sendWhatsappTemplate ke neeche)

export async function sendTextMessage({ to, text }) {
     const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

     const body = {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
     };

     const res = await fetch(url, {
          method: "POST",
          headers: {
               Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
               "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
     });

     const json = await res.json();
     console.log("WhatsApp text message response =>", json);
     return json;
}

// 📌 Trigger → Backend: order create hone par vendor ko Accept template
export const onOrderCreated = async (req, res) => {
     try {
          const { order_id, v_id } = req.body;

          if (!order_id || !v_id) {
               return res.status(400).json({ error: "order_id or v_id missing" });
          }

          // 1️⃣ Order
          const { order, vendor, user, itemsText } = await getFullOrderDetails(order_id);

          const toNumber = vendor.mobile_number.replace(/\D/g, "");

          // 6️⃣ Send "Accept Order" template
          const whatsappRes = await sendWhatsappTemplate({
               to: toNumber,
               templateName: "order_status", // <-- template name
               bodyParams: [
                    { type: "text", text: order_id },                 // {{1}} Order ID
                    { type: "text", text: String(order.total_amount) }, // {{2}} Amount
                    { type: "text", text: user.name },                // {{3}} Customer
                    { type: "text", text: itemsText },                // {{4}} Items list
               ],
               buttonPayload: `ACCEPT_ORDER:${order_id}`,          // button_reply.id
          });

          return res.status(200).json({ message: "WhatsApp sent", whatsappRes });
     } catch (err) {
          console.error("onOrderCreated error:", err);
          return res.status(500).json({ error: err.message });
     }
};
