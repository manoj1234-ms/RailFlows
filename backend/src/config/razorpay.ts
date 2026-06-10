import Razorpay from 'razorpay';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

let razorpayClient: any = null;

export function getRazorpay(): any {
  if (razorpayClient) return razorpayClient;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    logger.warn('[Razorpay] Credentials missing in environment variables (.env). Real payment transactions will fail.');
    return null;
  }

  try {
    razorpayClient = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
    logger.info('[Razorpay] Client initialized successfully');
  } catch (error: any) {
    logger.error(`[Razorpay] Failed to initialize client: ${error.message}`);
    razorpayClient = null;
  }

  return razorpayClient;
}

export function isRazorpayConfigured(): boolean {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}
