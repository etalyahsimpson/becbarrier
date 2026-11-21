import { EventEmitter } from 'node:events';
import { parse as parseCookie } from 'cookie';
import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import type { AppConfig } from '../config.js';
import { verifySession } from '@becbarrier/security';

/**
 * Realtime alert/case-count refresh. Authenticated, tenant-scoped, derived
 * only from COMMITTED events. If the socket or Redis transport fails, the
 * polling endpoint returns the same accurate state — realtime never carries
 * financial authority and never streams bank values or raw email content.
 */

export interface RealtimeEvent {
  tenantId: string;
  type: 'alert_created' | 'stats_update';
  data: Record<string, unknown>;
}

class RealtimeBus extends EventEmitter {
  publish(event: RealtimeEvent): void {
    this.emit('event', event);
  }
}

export const realtimeBus = new RealtimeBus();
realtimeBus.setMaxListeners(50);

interface TenantSocket {
  ws: WebSocket;
  tenantId: string;
}

export function attachRealtime(server: Server, config: AppConfig): { wss: WebSocketServer; sockets: Set<TenantSocket> } {
  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set<TenantSocket>();

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (!url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    const cookies = parseCookie(req.headers.cookie ?? '');
    const payload = cookies.bb_session ? verifySession(config.sessionSigningKey, cookies.bb_session) : null;
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const tenantSocket: TenantSocket = { ws, tenantId: payload.tenantId };
      sockets.add(tenantSocket);
      ws.on('close', () => sockets.delete(tenantSocket));
      ws.on('error', () => sockets.delete(tenantSocket));
      ws.send(JSON.stringify({ type: 'connected', tenantScoped: true }));
    });
  });

  const listener = (event: RealtimeEvent): void => {
    const message = JSON.stringify({ type: event.type, data: event.data });
    for (const s of sockets) {
      if (s.tenantId === event.tenantId && s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(message);
      }
    }
  };
  realtimeBus.on('event', listener);

  wss.on('close', () => realtimeBus.off('event', listener));
  return { wss, sockets };
}

/** Publish after COMMIT only (callers invoke post-transaction). */
export function publishCommitted(tenantId: string, type: RealtimeEvent['type'], data: Record<string, unknown>): void {
  try {
    realtimeBus.publish({ tenantId, type, data });
  } catch {
    // realtime is best-effort; polling remains authoritative
  }
}
