import { razorpay } from "../../config/razorpay.js";
import { supabase } from "../../config/supbase.js";
import crypto from "crypto";
import jwt from 'jsonwebtoken';
import { decreaseWalletBalance } from "../walletControllers/walletController.js";

export const initilisePayment = async (req, res) => {
  try {
    const { amount, currency = 'INR', orderPayload } = req.body;
    const { user } = req;

    if (!orderPayload || user?.id !== orderPayload?.p_user_id) {
      return res.status(403).json({ error: 'Unauthorized or missing payload.' });
    }

    // ✅ Pre-payment checks (cart total, min order)
    if (orderPayload?.p_item_total < 49) {
      return res.status(400).json({ error: 'Minimum order value ₹49 required.' });
    }

    if (orderPayload.p_wallet_used && orderPayload.p_wallet_used > 0) {
      try {
        const walletReq = {
          body: {
            amount: orderPayload.p_wallet_used,
            order_id: orderPayload.p_order_id,
            type: 'debit',
            description: 'Online order wallet deduction'
          },
          user
        };

        const walletPromise = new Promise((resolve, reject) => {
          const mockRes = {
            status: (code) => ({
              json: (data) => {
                if (code === 200) {
                  console.log('✅ Wallet balance decreased successfully:', data);
                  resolve(data);
                } else {
                  console.error('❌ Wallet decrease failed:', data);
                  reject(new Error(data.message || 'Wallet decrease failed'));
                }
              }
            })
          };

          // Call the wallet controller
          decreaseWalletBalance(walletReq, mockRes);
        });

        // Wait for wallet decrease to complete
        await walletPromise;

      } catch (walletError) {
        console.error('❌ Error decreasing wallet balance:', walletError);
        return res.status(400).json({
          message: 'Failed to deduct wallet balance',
          error: walletError.message
        });
      }
    }


    // ✅ Create pending order via RPC
    const { data: pendingOrder, error: rpcError } = await supabase.rpc("create_order", orderPayload);

    if (rpcError) {
      console.error('❌ RPC error:', rpcError);
      return res.status(400).json({ error: rpcError.message });
    }

    // Safely handle array vs object
    const orderData = Array.isArray(pendingOrder) ? pendingOrder[0] : pendingOrder;


    if (!orderData) {
      return res.status(500).json({ message: 'Pending order creation failed.' });
    }

    switch (orderData.status) {
      case 'success':
        console.log('✅ Pending order created with ID:', orderData.order_id);
        break; // continue to Razorpay creation

      case 'item_not_found':
        return res.status(404).json(orderData);

      case 'item_deactivated':
        return res.status(410).json(orderData);

      case 'price_change':
        return res.status(409).json(orderData);

      default:
        return res.status(500).json({ message: 'Unexpected response from RPC.' });
    }

    // ✅ Log success, continue to Razorpay order creation
    console.log('✅ Pending order created with ID:', orderData.order_id);

    // ✅ Create Razorpay payment order
    const receipt = `rcpt_${crypto.randomBytes(12).toString('hex')}`;
    const options = {
      amount: Math.round(amount * 100),
      currency,
      receipt,
      notes: {
        internal_order_id: orderData.order_id, // <--- Pass your DB ID here
      }

    };

    const order = await razorpay.orders.create(options);

    const payloadHash = crypto.createHash('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(JSON.stringify(orderPayload))
      .digest('hex');

    const paymentToken = jwt.sign({
      hash: payloadHash,
      razorpay_order_id: order.id,
      user_id: user?.id
    }, process.env.JWT_SECRET, { expiresIn: '15m' });

    // ✅ Return Razorpay order + pending_order_id
    return res.status(200).json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      token: paymentToken,
      pending_order_id: orderData.order_id
    });

  } catch (err) {
    console.error('🔥 Error initiating payment:', err);
    return res.status(500).json({ error: 'Failed to initiate order.' });
  }
};



export const finalisePayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderPayload, // This contains all the params for your RPC function
      token,
      pending_order_id
    } = req.body;

    const { user } = req;
    const paymentType = orderPayload?.p_payment_type;
    let razorpayAmount = 0;

    // STEP A: VERIFY SIGNATURE (only for online payments)
    if (paymentType === 'online') {
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ message: 'Missing required payment parameters.' });
      }

      if (!token) {
        return res.status(401).json({ message: 'Authorization token is missing.' });
      }

      let decodedToken;
      try {
        decodedToken = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired payment token.' });
      }

      console.log("decoded token", decodedToken);
      if (orderPayload?.p_user_id !== user?.id && decodedToken.user_id !== user?.id && orderPayload?.p_user_id !== decodedToken.user_id) {
        return res.status(403).json({ message: 'User is not authorized to finalize this payment.' });
      }

      if (decodedToken.razorpay_order_id !== razorpay_order_id) {
        return res.status(400).json({ message: 'Token and order ID mismatch.' });
      }

      const receivedPayloadHash = crypto.createHash('sha256', process.env.RAZORPAY_KEY_SECRET).update(JSON.stringify(orderPayload)).digest('hex');
      if (decodedToken.hash !== receivedPayloadHash) {
        return res.status(400).json({ message: 'Order details have been tampered with. Verification failed.' });
      }
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ message: 'Invalid payment signature.' });
      }
      console.log('✅ Payment signature verified successfully.');

      const payment = await razorpay.payments.fetch(razorpay_payment_id);
      razorpayAmount = payment.amount;
      if (!payment) {
        return res.status(404).json({ message: "Payment not found on Razorpay." });
      }

      if (payment.order_id !== razorpay_order_id) {
        return res.status(400).json({ message: "Payment does not belong to the given order." });
      }

      if (payment.status !== "captured") {
        return res.status(400).json({ message: `Payment is not captured. Current status: ${payment.status}` });
      }


    }

    // STEP C: PREPARE AND CALL THE SECURE RPC FUNCTION
    const rpcParams = {
      p_order_id: pending_order_id,
      p_payment_type: orderPayload.p_payment_type,
      p_payment_id: paymentType === 'online' ? razorpay_payment_id : 'cod',
      p_razorpay_order_id: paymentType === 'online' ? razorpay_order_id : null,
      p_paid_amount: paymentType === 'online' ? razorpayAmount : 0,
      p_user_id: orderPayload.p_user_id,
      p_address_id: orderPayload.p_address_id,
      p_cart_vendor_id: orderPayload.p_cart_vendor_id,
      p_cart_items: orderPayload.p_cart_items,
      p_tax_collected: orderPayload.p_tax_collected,
    };


    // Assuming you have a Supabase service role client initialized
    // const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase.rpc("verify_payment", rpcParams);

    // STEP D: HANDLE POSTGRES-LEVEL ERRORS (e.g., connection issue, RLS violation)
    if (error) {
      console.error("❌ Supabase RPC Error:", error);

      // Default fallback
      let statusCode = 400;
      let message = error.message || "Order finalization failed";

      // If message is JSON, parse it
      if (typeof error.message === "string" && error.message.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(error.message);
          statusCode = parsed.status || statusCode;
          return res.status(statusCode).json(parsed);
        } catch (_) {
          return res.status(500).json({ message: "Failed to place order after payment." });
        }
      }

      // Plain postgres exception
      return res.status(statusCode).json({
        status: statusCode,
        message
      });
    }

    if (data?.status === 'already_failed' && data.refund_amount > 0) {
      console.log("💰 Refund required for order:", data.order_id);

      const refund = await razorpay.payments.refund(data.payment_id, {
        amount: data.refund_amount * 100,
        refund_to_source: true
      });

      console.log("✅ Refund processed from backend:", refund);
    }

    // STEP E: HANDLE BUSINESS LOGIC RESPONSES FROM THE FUNCTION
    if (data) {
      console.log("RPC Data:", data);

      switch (data.status) {
        case 'success':
          return res.status(200).json(data);

        case 'already_processed':
          return res.status(200).json({
            message: "Order already finalized.",
            order_id: data.order_id,
            current_status: data.current_status || 'Placed'
          });

        case 'failed':
        case 'payment_failed':
          return res.status(400).json(data);

        case 'item_not_found':
          return res.status(404).json(data);

        case 'item_deactivated':
          return res.status(410).json(data);

        default:
          console.error('❓ Unexpected RPC status:', data.status);
          return res.status(500).json({ message: 'Unknown RPC response received.' });
      }
    }

    // STEP 3: Fallback if no data and no error
    return res.status(500).json({ message: 'Unexpected state: no RPC data and no error.' });

  } catch (err) {
    console.error('🔥 Fatal Error in /api/finalize-order:', err);
    res.status(500).json({ message: 'Internal server error during order finalization.' });
  }
}

export const codOrderCreation = async (req, res) => {
  try {
    const {
      orderPayload
    } = req.body;

    const { user } = req;

    if (orderPayload?.p_user_id !== user?.id) {
      return res.status(403).json({ message: 'User is not authorized to create order.' });
    }

    // STEP B: DECREASE WALLET BALANCE (if wallet is used)
    if (orderPayload.p_wallet_used && orderPayload.p_wallet_used > 0) {
      try {
        // Create a mock request and response object for the wallet controller
        const walletReq = {
          body: {
            amount: orderPayload.p_wallet_used,
            order_id: orderPayload.p_order_id,
            type: 'debit',
            description: 'Order payment deduction'
          },
          user: user
        };

        // Create a promise to handle the wallet decrease
        const walletPromise = new Promise((resolve, reject) => {
          const mockRes = {
            status: (code) => ({
              json: (data) => {
                if (code === 200) {
                  console.log('✅ Wallet balance decreased successfully:', data);
                  resolve(data);
                } else {
                  console.error('❌ Wallet decrease failed:', data);
                  reject(new Error(data.message || 'Wallet decrease failed'));
                }
              }
            })
          };

          // Call the wallet controller
          decreaseWalletBalance(walletReq, mockRes);
        });

        // Wait for wallet decrease to complete
        await walletPromise;

      } catch (walletError) {
        console.error('❌ Error decreasing wallet balance:', walletError);
        return res.status(400).json({
          message: 'Failed to deduct wallet balance',
          error: walletError.message
        });
      }
    }

    // STEP C: PREPARE AND CALL THE SECURE RPC FUNCTION
    const rpcParams = {
      ...orderPayload
    };

    // Assuming you have a Supabase service role client initialized
    // const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase.rpc("create_order", rpcParams);

    // STEP D: HANDLE POSTGRES-LEVEL ERRORS (e.g., connection issue, RLS violation)
    if (error) {
      console.error("❌ Supabase RPC Error:", error);

      // Default fallback
      let statusCode = 400;
      let message = error.message || "Order finalization failed";

      // If message is JSON, parse it
      if (typeof error.message === "string" && error.message.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(error.message);
          statusCode = parsed.status || statusCode;
          return res.status(statusCode).json(parsed);
        } catch (_) {
          return res.status(500).json({ message: "Failed to place order after payment." });
        }
      }

      // Plain postgres exception
      return res.status(statusCode).json({
        status: statusCode,
        message
      });
    }


    // STEP E: HANDLE BUSINESS LOGIC RESPONSES FROM THE FUNCTION
    if (!data) {
      return res.status(500).json({ message: 'Order creation failed.' });
    }

    switch (data.status) {
      case 'success':
        console.log('✅ Order created with ID:', data.order_id);
        break; // continue to Razorpay creation

      case 'item_not_found':
        return res.status(404).json(data);

      case 'item_deactivated':
        return res.status(410).json(data);

      case 'price_change':
        return res.status(409).json(data);

      default:
        return res.status(500).json({ message: 'Unexpected response from RPC.' });
    }

    // ✅ Log success, continue to Razorpay order creation
    console.log('✅ Order created with ID:', data.order_id);

    // STEP 3: Fallback if no data and no error
    return res.status(500).json({ message: 'Unexpected state: no RPC data and no error.' });

  } catch (err) {
    console.error('🔥 Fatal Error in /api/cod-order-creation:', err);
    res.status(500).json({ message: 'Internal server error during order finalization.' });
  }
}

