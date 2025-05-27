import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(accountSid, authToken);

export const sendSMS = async (phone, otp) => {
  try {
    const formattedPhone = phone.startsWith('0') ? `+84${phone.substring(1)}` : phone;
    
    await client.messages.create({
      body: `Mã OTP của bạn là: ${otp}. Mã có hiệu lực trong 60 giây.`,
      from: fromNumber,
      to: formattedPhone
    });
    
    console.log(`SMS sent to ${formattedPhone} successfully`);
    return true;
  } catch (error) {
    console.error('Error sending SMS:', error);
    return false;
  }
}; 