import { motion } from 'framer-motion';

export default function Privacy() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
        <h1 className="text-4xl font-bold">Privacy Policy</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Last updated: June 2026</p>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">1. Information We Collect</h2>
          <p className="text-[var(--color-text-muted)] leading-relaxed">
            We collect information you provide when creating an account, making a booking, or contacting support.
            This includes your name, email address, phone number, Aadhaar number (for identity verification), and payment details.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">2. How We Use Your Information</h2>
          <p className="text-[var(--color-text-muted)] leading-relaxed">
            Your information is used to process bookings, send travel updates, improve our services, and comply with legal obligations.
            We never share your Aadhaar or payment data with third parties without explicit consent.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">3. Data Security</h2>
          <p className="text-[var(--color-text-muted)] leading-relaxed">
            We implement industry-standard encryption, secure tokenization for payments, and strict access controls.
            All Aadhaar data is handled in compliance with the DPDP Act 2023 and UIDAI guidelines.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">4. Your Rights</h2>
          <p className="text-[var(--color-text-muted)] leading-relaxed">
            You may access, correct, or delete your personal data at any time through your profile settings.
            For data requests, contact our Data Protection Officer at dpo@railflow.app.
          </p>
        </section>
      </motion.div>
    </div>
  );
}
