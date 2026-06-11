import { motion } from 'framer-motion';
import { Briefcase, MapPin, Clock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const positions = [
  { title: 'Senior Full Stack Engineer', dept: 'Engineering', location: 'Bangalore, India', type: 'Full-time' },
  { title: 'Product Manager - Mobility', dept: 'Product', location: 'Remote', type: 'Full-time' },
  { title: 'Data Scientist - AI/ML', dept: 'AI & Data', location: 'Bangalore, India', type: 'Full-time' },
  { title: 'UX Designer', dept: 'Design', location: 'Remote', type: 'Contract' },
];

export default function Careers() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 space-y-12">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Join the RailFlow Team</h1>
        <p className="text-lg text-[var(--color-text-muted)] max-w-2xl mx-auto">
          Help us build the future of train travel in India. We're looking for passionate people who love solving hard problems.
        </p>
      </motion.div>

      <div className="space-y-6">
        <h2 className="text-2xl font-semibold">Open Positions</h2>
        <div className="space-y-4">
          {positions.map((pos, i) => (
            <motion.div key={pos.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{pos.title}</h3>
                    <p className="text-sm text-[var(--color-text-muted)]">{pos.dept}</p>
                  </div>
                  <Button size="sm">Apply Now</Button>
                </div>
                <div className="flex gap-4 text-sm text-[var(--color-text-muted)]">
                  <span className="flex items-center gap-1"><MapPin size={14} /> {pos.location}</span>
                  <span className="flex items-center gap-1"><Clock size={14} /> {pos.type}</span>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
