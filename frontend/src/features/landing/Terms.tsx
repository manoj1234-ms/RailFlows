import { motion } from 'framer-motion';

export default function Terms() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
        <h1 className="text-4xl font-bold">Terms of Service</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Last updated: June 2026</p>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
          <p className="text-[var(--color-text-muted)] leading-relaxed">
            By using RailFlow, you agree to these terms. If you do not agree, please do not use our services.
            These terms are governed by the laws of India.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">2. Booking & Cancellation</h2>
          <p className="text-[var(--color-text-muted)] leading-relaxed">
            All bookings are subject to IRCTC terms and availability. Cancellation charges apply as per railway rules.
            Waitlist and RAC tickets follow Indian Railways quota policies. Refunds are processed within 5-7 working days.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">3. User Responsibilities</h2>
          <p className="text-[var(--color-text-muted)] leading-relaxed">
            You are responsible for providing accurate passenger and ID details. Fraudulent bookings or misuse of
            the platform may result in account suspension and legal action.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">4. Limitation of Liability</h2>
          <p className="text-[var(--color-text-muted)] leading-relaxed">
            RailFlow acts as an intermediary booking platform and is not liable for train delays, cancellations,
            or changes made by Indian Railways. Our liability is limited to the value of the booking fee.
          </p>
        </section>
      </motion.div>
    </div>
  );
}
