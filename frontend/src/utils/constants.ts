export const COACH_CLASSES = [
  { value: '1A', label: 'First AC', short: '1A' },
  { value: '2A', label: 'Second AC', short: '2A' },
  { value: '3A', label: 'Third AC', short: '3A' },
  { value: 'SL', label: 'Sleeper', short: 'SL' },
  { value: '2S', label: 'Second Sitting', short: '2S' },
  { value: 'CC', label: 'AC Chair Car', short: 'CC' },
  { value: 'EC', label: 'Executive Chair Car', short: 'EC' },
  { value: 'GN', label: 'General', short: 'GN' },
] as const;

export const QUOTA_TYPES = [
  { value: 'GN', label: 'General' },
  { value: 'TQ', label: 'Tatkal' },
  { value: 'PT', label: 'Premium Tatkal' },
  { value: 'LD', label: 'Ladies' },
  { value: 'SS', label: 'Senior Citizen' },
  { value: 'HO', label: 'Headquarters' },
  { value: 'PH', label: 'Parliament House' },
  { value: 'DF', label: 'Defence' },
  { value: 'RE', label: 'Railway Employee' },
] as const;

export const GENDER_OPTIONS = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'O', label: 'Other' },
] as const;

export const PAYMENT_METHODS = [
  { value: 'UPI', label: 'UPI (GPay / PhonePe / BHIM)' },
  { value: 'Credit Card', label: 'Credit Card' },
  { value: 'Debit Card', label: 'Debit Card' },
  { value: 'Net Banking', label: 'Net Banking' },
] as const;

export const BOOKING_STEPS = [
  { step: 1, label: 'Passengers' },
  { step: 2, label: 'Review & Pay' },
  { step: 3, label: 'Payment' },
  { step: 4, label: 'Confirm' },
] as const;
