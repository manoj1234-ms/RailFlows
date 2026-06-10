import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Bot, Send, User, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { chatbotApi } from '@/api/chatbot';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/utils/cn';
import type { ChatMessage } from '@/types';

const SUGGESTIONS = [
  'Check PNR status',
  'Tatkal booking info',
  'Cancel my ticket',
  'Loyalty points',
  'Train schedules',
  'Refund policy',
];

export default function ChatbotPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hello! I\'m RailFlow AI. Ask me about trains, bookings, or anything travel-related!' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (msg?: string) => {
    const userMsg = msg || input.trim();
    if (!userMsg) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const fn = isAuthenticated ? chatbotApi.askAuthenticated : chatbotApi.ask;
      const { data } = await fn(userMsg);
      clearTimeout(timeout);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.data.answer || data.data.reply }]);
    } catch (err: any) {
      const msg = err?.code === 'ERR_CANCELED' || err?.name === 'AbortError'
        ? 'Request timed out. Please check your connection and try again.'
        : err?.response?.status === 500
          ? 'The AI service is temporarily unavailable. Please try again later.'
          : 'Sorry, I\'m having trouble responding. Please try again.';
      setMessages((prev) => [...prev, { role: 'assistant', content: msg }]);
    } finally {
      setLoading(false);
    }
  }, [input, isAuthenticated]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-[var(--color-primary)]/20 flex items-center justify-center">
          <Bot className="text-[var(--color-primary)]" size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold">RailFlow AI Assistant</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Ask me anything about your travel</p>
        </div>
      </div>

      <Card className="h-[60vh] flex flex-col p-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
            >
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center shrink-0">
                  <Bot size={14} className="text-[var(--color-primary)]" />
                </div>
              )}
              <div className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-[var(--color-primary)] text-white rounded-br-none'
                  : 'glass rounded-bl-none'
              }`}>
                {msg.content}
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-[var(--color-border)] flex items-center justify-center shrink-0">
                  <User size={14} />
                </div>
              )}
            </motion.div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center">
                <Bot size={14} className="text-[var(--color-primary)]" />
              </div>
              <div className="glass rounded-xl rounded-bl-none px-4 py-2.5">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] animate-bounce" />
                  <div className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-[var(--color-border)]">
          {messages.length <= 2 && !loading && (
            <div className="flex flex-wrap gap-1.5 px-4 pt-3 pb-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleSend(s)}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full glass border border-[var(--color-border)] hover:border-[var(--color-primary)]/50 transition-colors cursor-pointer"
                >
                  <Sparkles size={10} className="text-[var(--color-primary)]" />
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="p-4">
            <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
              <Input
                placeholder="Ask about trains, schedules, fares..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" disabled={!input.trim() || loading}>
                <Send size={16} />
              </Button>
            </form>
          </div>
        </div>
      </Card>
    </div>
  );
}
