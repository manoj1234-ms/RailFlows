import { motion } from 'framer-motion';
import { Calendar, Clock, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Link } from 'react-router-dom';

const posts = [
  { title: 'How AI is Transforming Train Travel in India', excerpt: 'From predictive maintenance to personalized recommendations — here is how RailFlow uses AI to make train travel smarter.', date: '2026-06-01', readTime: '5 min', author: 'RailFlow Team' },
  { title: 'Understanding the New IRCTC Integration', excerpt: 'A deep dive into how our IRCTC integration works and what it means for your booking experience.', date: '2026-05-25', readTime: '7 min', author: 'Engineering Team' },
  { title: 'Travel Tips: How to Get Confirmed Tickets Every Time', excerpt: 'Expert strategies for improving your chances of confirmed tickets during peak season.', date: '2026-05-18', readTime: '4 min', author: 'Travel Desk' },
  { title: 'The Future of Digital Payments in Indian Railways', excerpt: 'How UPI, digital wallets, and biometric payments are changing the way India travels.', date: '2026-05-10', readTime: '6 min', author: 'Product Team' },
];

export default function Blog() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 space-y-12">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4">
        <h1 className="text-4xl font-bold">RailFlow Blog</h1>
        <p className="text-lg text-[var(--color-text-muted)] max-w-2xl mx-auto">
          Insights, updates, and stories from the team building India's smartest train travel platform.
        </p>
      </motion.div>

      <div className="space-y-6">
        {posts.map((post, i) => (
          <motion.div key={post.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Card className="space-y-3">
              <h2 className="font-semibold text-lg">{post.title}</h2>
              <p className="text-sm text-[var(--color-text-muted)]">{post.excerpt}</p>
              <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
                <span className="flex items-center gap-1"><Calendar size={12} /> {post.date}</span>
                <span className="flex items-center gap-1"><Clock size={12} /> {post.readTime}</span>
                <span>{post.author}</span>
              </div>
              <Link to="#" className="text-sm text-[var(--color-primary)] hover:underline inline-flex items-center gap-1">
                Read more <ArrowRight size={12} />
              </Link>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
