import { Server as HttpServer } from 'http';
import { Server as WsServer, WebSocket } from 'ws';
import { getDb } from '../config/db';
import logger from '../utils/logger';

interface TrackSubscription {
  trainNumber: string;
  ws: WebSocket;
  interval?: NodeJS.Timeout;
}

const subscriptions = new Map<WebSocket, TrackSubscription>();
let wssInstance: WsServer | null = null;

export function closeLiveTracking(): void {
  if (wssInstance) {
    for (const [, sub] of subscriptions) {
      if (sub.interval) clearInterval(sub.interval);
      if (sub.ws.readyState === WebSocket.OPEN || sub.ws.readyState === WebSocket.CONNECTING) {
        sub.ws.close(1001, 'Server shutting down');
      }
    }
    subscriptions.clear();
    wssInstance.close();
    wssInstance = null;
    logger.info('[LiveTracking] WebSocket server closed');
  }
}

export function setupLiveTracking(server: HttpServer): WsServer {
  const wss = new WsServer({ server, path: '/ws/live-tracking' });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', 'http://localhost');
    const trainNumber = url.searchParams.get('train');

    if (!trainNumber) {
      ws.close(4000, 'train parameter required');
      return;
    }

    logger.info(`[LiveTracking] Client connected for train ${trainNumber}`);

    const sub: TrackSubscription = { trainNumber, ws };
    subscriptions.set(ws, sub);

    sub.interval = setInterval(async () => {
      try {
        const db = await getDb();
        const status = await db.get(
          `SELECT lts.*, s.name AS current_station_name, ns.name AS next_station_name
           FROM live_train_status lts
           LEFT JOIN stations s ON lts.current_station = s.code
           LEFT JOIN stations ns ON lts.next_station = ns.code
           WHERE lts.train_number = ?`,
          [trainNumber]
        );
        if (status && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'status', data: status }));
        }
      } catch (err: any) {
        logger.error({ msg: '[LiveTracking] Poll error', error: err.message });
      }
    }, 5000);

    ws.on('close', () => {
      logger.info(`[LiveTracking] Client disconnected for train ${trainNumber}`);
      if (sub.interval) clearInterval(sub.interval);
      subscriptions.delete(ws);
    });

    ws.on('error', () => {
      if (sub.interval) clearInterval(sub.interval);
      subscriptions.delete(ws);
    });
  });

  wssInstance = wss;
  logger.info('[LiveTracking] WebSocket server initialized at /ws/live-tracking');
  return wss;
}
