export const verifyPaymentCore = async ({ supabase, rpcParams }) => {
     const controller = new AbortController();

     const timeoutId = setTimeout(() => {
          console.log("⏱️ ABORT FIRED");
          controller.abort();
     }, 3000);

     const { data, error } = await supabase.rpc(
          "verify_payment",
          rpcParams,
          { signal: controller.signal }
     );

     clearTimeout(timeoutId);

     if (error) {
          const isTimeout =
               error.code === "57014" ||
               error.message?.toLowerCase().includes("timeout") ||
               error.status === 504;

          if (isTimeout) {
               // ⛔ throw ONLY timeout
               throw error;
          }

          // ❌ non-timeout error returned normally
          return { data: null, error };
     }

     return { data, error: null };
};
