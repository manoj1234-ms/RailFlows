/**
 * Live Tracking WebSocket Service
 *
 * Security: Authenticates clients via Sec-WebSocket-Protocol subprotocol header
 * instead of a ?token= query parameter. Query params appear in:
 *   - Nginx access logs
 *   - Cloudflare logs
 *   - Browser history
 *   - HTTP Referer headers
 *
 * Protocol handshake:
 *   Client sends:   Sec-WebSocket-Protocol: railflow-v1, Bearer.<jwt>
 *   Server reads:   second protocol value → strip 'Bearer.' prefix → verify JWT
 *   Server replies: Sec-WebSocket-Protocol: railflow-v1  (required by WS spec)
 *   On invalid JWT: HTTP 401 before connection is established
 *
 * Train selection:
 *   Still passed as a ?train= query param (not sensitive — it's a train number).
 */

import { Server as HttpServer } from 'http';
import { Server as WsServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { getDb } from '../config/db';
import logger from '../utils/logger';
import { RailwayApiService } from './railway-api.service';

const JWT_SECRET = process.env.JWT_SECRET || 'railflow-secret';
const PROTOCOL_SENTINEL = 'railflow-v1';

interface TrackSubscription {
  trainNumber: string;
  userId: number;
  ws: WebSocket;
  interval?: NodeJS.Timeout;
}

const subscriptions = new Map<WebSocket, TrackSubscription>();
let wssInstance: WsServer | null = null;

/**
 * Extract and verify the JWT from the Sec-WebSocket-Protocol header.
 * Expected header format: "railflow-v1, Bearer.<token>"
 * Returns decoded userId on success, null on failure.
 */
function authenticateWsRequest(req: IncomingMessage): { userId: number } | null {
  const protocolHeader = req.headers['sec-websocket-protocol'] || '';
  const protocols = protocolHeader.split(',').map((p) => p.trim());

  // Find the Bearer.<token> segment
  const bearerEntry = protocols.find((p) => p.startsWith('Bearer.'));
  if (!bearerEntry) return null;

  const token = bearerEntry.slice('Bearer.'.length);
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id?: number; userId?: number };
    const userId = decoded.id ?? decoded.userId;
    if (!userId) return null;
    return { userId };
  } catch {
    return null;
  }
}

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
  const wss = new WsServer({
    server,
    path: '/ws/live-tracking',
    /**
     * handleProtocols: called during the WS upgrade handshake.
     * Must return the accepted subprotocol string, or false to reject the connection.
     * We authenticate here so that unauthenticated upgrades are rejected before
     * the WebSocket connection object is even created.
     */
    handleProtocols: (protocols: Set<string>, req: IncomingMessage): string | false => {
      const auth = authenticateWsRequest(req);
      if (!auth) {
        logger.warn({ msg: '[LiveTracking] WS upgrade rejected — invalid or missing token', ip: req.socket.remoteAddress });
        return false; // triggers HTTP 401
      }
      // Respond with the sentinel protocol to complete the handshake
      return PROTOCOL_SENTINEL;
    },
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Re-read userId from the request (handleProtocols already validated it)
    const auth = authenticateWsRequest(req);
    if (!auth) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const url = new URL(req.url || '', 'http://localhost');
    const trainNumber = url.searchParams.get('train');

    if (!trainNumber) {
      ws.close(4000, 'train parameter required');
      return;
    }

    logger.info(`[LiveTracking] Client connected — userId=${auth.userId} train=${trainNumber}`);

    const sub: TrackSubscription = { trainNumber, userId: auth.userId, ws };
    subscriptions.set(ws, sub);

    sub.interval = setInterval(async () => {
      try {
        const status = await RailwayApiService.getLiveStatus(trainNumber);
        if (status && ws.readyState === WebSocket.OPEN) {
          // Map to format expected by frontend (columns of live_train_status)
          const legacyFormat = {
            train_number: status.trainNumber,
            current_station: status.currentStation?.code,
            current_station_name: status.currentStation?.name,
            next_station: status.nextStation?.code,
            next_station_name: status.nextStation?.name,
            status: status.status,
            delay_minutes: status.delayMinutes,
            speed_kmh: status.speedKmh,
            expected_arrival: status.expectedArrival,
            last_updated: status.lastUpdated,
          };
          ws.send(JSON.stringify({ type: 'status', data: legacyFormat }));
        }
      } catch (err: any) {
        logger.error({ msg: '[LiveTracking] WS Poll error', error: err.message });
      }
    }, 5000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch { /* ignore malformed frames */ }
    });

    ws.on('close', () => {
      logger.info(`[LiveTracking] Client disconnected — userId=${auth.userId} train=${trainNumber}`);
      if (sub.interval) clearInterval(sub.interval);
      subscriptions.delete(ws);
    });

    ws.on('error', () => {
      if (sub.interval) clearInterval(sub.interval);
      subscriptions.delete(ws);
    });
  });

  wssInstance = wss;
  logger.info('[LiveTracking] WebSocket server initialized at /ws/live-tracking (subprotocol auth)');
  return wss;
}
