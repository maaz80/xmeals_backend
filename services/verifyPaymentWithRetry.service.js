import { verifyPaymentCore } from "../services/verifyPayment.core.js";

export const verifyPaymentWithRetry = async ({
     supabase,
     rpcParams,
     fromWebhook = false,
     onFirstTimeout // 👈 callback

}) => {
     const delays = [0, 10000, 15000];
     let lastError;

     for (let attempt = 0; attempt < delays.length; attempt++) {
          try {
               if (delays[attempt] > 0) {
                    await new Promise(r => setTimeout(r, delays[attempt]));
               }

               return await verifyPaymentCore({
                    supabase,
                    rpcParams
               });

          } catch (err) {
               lastError = err;
               const isTimeout =
                    err.code === "57014" ||
                    err.message?.toLowerCase().includes("timeout");

               // 🔔 FIRST timeout + webhook call
               if (fromWebhook && attempt === 0 && isTimeout) {
                    if (typeof onFirstTimeout === "function") {
                         onFirstTimeout(); // 👈 signal webhook
                    }
               }
          }
     }

     return { data: null, error: lastError };
};
