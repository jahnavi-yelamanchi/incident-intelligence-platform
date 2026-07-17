export type RealtimeSocket = { readyState: number; bufferedAmount: number; send: (message: string) => void; close: (code: number, reason?: string) => void };
type RealtimeMessage = { type: string; payload: unknown; occurredAt: string };

const open = 1;
const maximumBufferedBytes = 1_000_000;

export class RealtimeHub {
  private readonly connections = new Map<string, Set<RealtimeSocket>>();

  add(organizationId: string, socket: RealtimeSocket) {
    const connections = this.connections.get(organizationId) ?? new Set<RealtimeSocket>();
    connections.add(socket);
    this.connections.set(organizationId, connections);
    return () => {
      connections.delete(socket);
      if (connections.size === 0) this.connections.delete(organizationId);
    };
  }

  publish(organizationId: string, type: string, payload: unknown) {
    const message: RealtimeMessage = { type, payload, occurredAt: new Date().toISOString() };
    for (const socket of this.connections.get(organizationId) ?? []) {
      if (socket.readyState !== open) continue;
      if (socket.bufferedAmount > maximumBufferedBytes) { socket.close(1013, "client backpressure"); continue; }
      socket.send(JSON.stringify(message));
    }
  }
}

export function accessTokenFromSocketProtocol(protocol: string | undefined) {
  const value = protocol?.split(",").map((entry) => entry.trim()).find((entry) => entry.startsWith("aegis."));
  return value ? value.slice("aegis.".length) : null;
}
