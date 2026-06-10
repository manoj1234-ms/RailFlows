import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/Card';

const faqs = [
  { q: 'How do I book a train ticket?', a: 'Use the search page to find trains between stations, select your coach and seats, add passenger details, and complete payment.' },
  { q: 'What is the virtual queue?', a: 'During high demand, you join a virtual queue to secure your booking window. Your position updates in real-time with anti-tampering protection.' },
  { q: 'How does the waitlist prediction work?', a: 'Our ML model analyzes historical data to predict your waitlist confirmation probability and estimated clearance date.' },
  { q: 'Can I cancel a booking?', a: 'Yes, you can cancel full or partial bookings from My Trips. Refunds are processed based on IRCTC cancellation rules.' },
  { q: 'How do I download my e-ticket?', a: 'After successful booking, you can download the PDF e-ticket from the booking success page or My Trips section.' },
  { q: 'Is my payment secure?', a: 'Absolutely. We are PCI DSS v4.0 compliant. All card data is tokenized at the edge and never stored on our servers.' },
  { q: 'What is the loyalty program?', a: 'Earn points on every booking. Redeem them for discounts, upgrades, and exclusive rewards. Higher tiers unlock more benefits.' },
  { q: 'How does the AI chatbot work?', a: 'Our AI assistant can answer travel queries, help with bookings, check PNR status, and provide personalized recommendations 24/7.' },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="max-w-3xl mx-auto px-4 py-16 space-y-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4">
        <h1 className="text-4xl font-bold">FAQ</h1>
        <p className="text-[var(--color-text-muted)]">Frequently asked questions</p>
      </motion.div>

      <div className="space-y-3">
        {faqs.map((faq, i) => (
          <Card key={i} className="p-0 overflow-hidden">
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full p-4 flex items-center justify-between text-left cursor-pointer"
            >
              <span className="font-medium text-sm">{faq.q}</span>
              <ChevronDown size={16} className={`transition-transform ${open === i ? 'rotate-180' : ''}`} />
            </button>
            {open === i && (
              <div className="px-4 pb-4 text-sm text-[var(--color-text-muted)] border-t border-[var(--color-border)] pt-3">
                {faq.a}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
