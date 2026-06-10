import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Link } from 'react-router-dom';

const plans = [
  {
    name: 'Free',
    price: '₹0',
    desc: 'For occasional travellers',
    features: ['Train search', 'PNR enquiry', 'Basic support', 'Email notifications'],
  },
  {
    name: 'Premium',
    price: '₹199',
    period: '/month',
    desc: 'For regular commuters',
    features: ['Everything in Free', 'Priority queue access', 'AI chatbot priority', 'Wallet & rewards', 'Ad-free experience'],
    popular: true,
  },
  {
    name: 'Business',
    price: '₹499',
    period: '/month',
    desc: 'For frequent travellers',
    features: ['Everything in Premium', 'Dedicated support', 'API access', 'Team management', 'Advanced analytics'],
  },
];

export default function Pricing() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-16 space-y-12">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Pricing</h1>
        <p className="text-[var(--color-text-muted)] text-lg">Choose the plan that fits your travel needs</p>
      </motion.div>

      <div className="grid md:grid-cols-3 gap-6">
        {plans.map((plan, i) => (
          <motion.div key={plan.name} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Card className={`h-full flex flex-col space-y-6 ${plan.popular ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]' : ''}`}>
              {plan.popular && (
                <div className="text-xs font-semibold text-[var(--color-primary)] uppercase tracking-wider">Most Popular</div>
              )}
              <div>
                <h3 className="text-xl font-bold">{plan.name}</h3>
                <div className="mt-2">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  {plan.period && <span className="text-[var(--color-text-muted)] text-sm">{plan.period}</span>}
                </div>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">{plan.desc}</p>
              </div>
              <ul className="flex-1 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Check size={16} className="text-[var(--color-success)] shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link to="/register"><Button className="w-full" variant={plan.popular ? 'primary' : 'outline'}>{plan.name === 'Free' ? 'Get Started' : 'Subscribe'}</Button></Link>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
