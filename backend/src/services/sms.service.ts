import logger from '../utils/logger';

export class SmsService {
  /**
   * Dispatches a 6-digit numeric OTP to the specified phone number via Twilio REST API.
   * If credentials are not set, it logs the OTP to the console.
   */
  static async sendOtp(phone: string, otp: string): Promise<boolean> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    // Standard Indian phone formatting (+91 prefix if not starting with '+')
    const formattedPhone = phone.startsWith('+') ? phone : `+91${phone}`;

    if (!accountSid || !authToken || !fromNumber) {
      logger.info(`[SMS Service] [DEV FALLBACK] SMS OTP for ${formattedPhone}: ${otp}`);
      return true;
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

      const params = new URLSearchParams();
      params.append('To', formattedPhone);
      params.append('From', fromNumber);
      params.append('Body', `RailFlow Verification: Your OTP is ${otp}. Valid for 5 minutes.`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error(`[SMS Service] Twilio request failed: ${response.status} - ${errText}`);
        return false;
      }

      const resData = await response.json();
      logger.info(`[SMS Service] SMS sent successfully to ${formattedPhone}. SID: ${resData.sid}`);
      return true;
    } catch (error: any) {
      logger.error(`[SMS Service] Error connecting to Twilio: ${error.message}`);
      return false;
    }
  }
}
