/**
 * LiveTrackingWidget.tsx
 * Opens a real WebSocket connection to ws://localhost:5000/ws/live-tracking?train=<NUMBER>
 * and displays live status updates as they arrive from the backend simulation.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Radio, MapPin, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface TrackStatus {
  train_number: string;
  current_station?: string;
  current_station_name?: string;
  next_station?: string;
  next_station_name?: string;
  delay_minutes?: number;
  speed_kmph?: number;
  last_updated?: string;
  latitude?: number;
  longitude?: number;
}

interface Props {
  trainNumber: string;
  onClose: () => void;
}

type ConnState = 'connecting' | 'connected' | 'disconnected' | 'error';

export default function LiveTrackingWidget({ trainNumber, onClose }: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<TrackStatus | null>(null);
  const [connState, setConnState] = useState<ConnState>('connecting');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://localhost:5000'}/ws/live-tracking?train=${encodeURIComponent(trainNumber)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnState('connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'status' && msg.data) {
          setStatus(msg.data);
          setLastUpdate(new Date());
          // Pulse animation on new data
          setPulse(true);
          setTimeout(() => setPulse(false), 600);
        }
      } catch { /* ignore malformed */ }
    };

    ws.onerror = () => setConnState('error');
    ws.onclose = () => setConnState('disconnected');

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [trainNumber]);

  const reconnect = () => {
    if (wsRef.current) wsRef.current.close();
    setConnState('connecting');
    setStatus(null);
    const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://localhost:5000'}/ws/live-tracking?train=${encodeURIComponent(trainNumber)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => setConnState('connected');
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'status' && msg.data) {
          setStatus(msg.data);
          setLastUpdate(new Date());
          setPulse(true);
          setTimeout(() => setPulse(false), 600);
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => setConnState('error');
    ws.onclose = () => setConnState('disconnected');
  };

  const connColors: Record<ConnState, string> = {
    connecting: 'text-amber-400',
    connected: 'text-emerald-400',
    disconnected: 'text-slate-400',
    error: 'text-red-400',
  };

  const connLabels: Record<ConnState, string> = {
    connecting: 'Connecting…',
    connected: 'Live',
    disconnected: 'Disconnected',
    error: 'Connection Error',
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-5 relative"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg bg-sky-500/20 flex items-center justify-center ${pulse ? 'scale-110' : ''} transition-transform`}>
              <Radio size={20} className="text-sky-400" />
            </div>
            <div>
              <h2 className="font-bold text-lg">Train {trainNumber}</h2>
              <div className={`flex items-center gap-1.5 text-xs font-medium ${connColors[connState]}`}>
                <span className={`w-2 h-2 rounded-full ${connState === 'connected' ? 'bg-emerald-400 animate-pulse' : connState === 'connecting' ? 'bg-amber-400 animate-ping' : 'bg-slate-400'}`} />
                {connLabels[connState]}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Status content */}
        {connState === 'connecting' && (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-[var(--color-text-muted)]">
            <Loader2 size={36} className="animate-spin text-[var(--color-primary)]" />
            <p className="text-sm">Establishing live connection…</p>
          </div>
        )}

        {connState === 'error' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-red-400">
            <AlertCircle size={36} />
            <p className="text-sm text-center">Failed to connect. Make sure the backend is running.</p>
            <Button size="sm" onClick={reconnect}>Retry</Button>
          </div>
        )}

        {connState === 'disconnected' && !status && (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-[var(--color-text-muted)]">
            <AlertCircle size={36} />
            <p className="text-sm text-center">WebSocket disconnected. No data for this train number yet.</p>
            <Button size="sm" onClick={reconnect}>Reconnect</Button>
          </div>
        )}

        {status && (
          <motion.div
            key={status.last_updated}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {/* Current / Next Station */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-800/60 rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                  <MapPin size={12} /> Current Station
                </div>
                <p className="font-bold text-[var(--color-text)]">
                  {status.current_station_name || status.current_station || '—'}
                </p>
                {typeof status.delay_minutes === 'number' && (
                  <p className={`text-xs ${status.delay_minutes > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {status.delay_minutes > 0 ? `${status.delay_minutes} min delay` : 'On time'}
                  </p>
                )}
              </div>
              <div className="bg-slate-800/60 rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                  <MapPin size={12} className="text-sky-400" /> Next Station
                </div>
                <p className="font-bold text-[var(--color-text)]">
                  {status.next_station_name || status.next_station || '—'}
                </p>
              </div>
            </div>

            {/* Speed & Coordinates */}
            <div className="grid grid-cols-3 gap-3">
              {typeof status.speed_kmph === 'number' && (
                <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-[var(--color-primary)]">{status.speed_kmph}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">km/h</div>
                </div>
              )}
              {status.latitude !== undefined && (
                <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                  <div className="text-sm font-mono font-bold">{status.latitude?.toFixed(4)}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">Latitude</div>
                </div>
              )}
              {status.longitude !== undefined && (
                <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                  <div className="text-sm font-mono font-bold">{status.longitude?.toFixed(4)}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">Longitude</div>
                </div>
              )}
            </div>

            {/* Last updated */}
            {lastUpdate && (
              <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                <Clock size={11} /> Updated {lastUpdate.toLocaleTimeString()}
              </p>
            )}
          </motion.div>
        )}

        {/* Connected but no data yet */}
        {connState === 'connected' && !status && (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-[var(--color-text-muted)]">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-sm">Waiting for first update…</p>
          </div>
        )}

        <Button variant="outline" size="sm" className="w-full" onClick={onClose}>Close</Button>
      </motion.div>
    </div>
  );
}
