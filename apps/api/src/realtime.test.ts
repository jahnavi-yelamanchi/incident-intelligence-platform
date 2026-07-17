import { describe, expect, it, vi } from "vitest";
import { accessTokenFromSocketProtocol, RealtimeHub } from "./realtime.js";

describe("realtime hub", () => {
  it("isolates tenant messages and applies client backpressure", () => {
    const hub = new RealtimeHub();
    const first = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() };
    const slow = { readyState: 1, bufferedAmount: 1_000_001, send: vi.fn(), close: vi.fn() };
    hub.add("tenant-a", first); hub.add("tenant-a", slow);
    hub.publish("tenant-a", "incident.updated", { id: "one" });
    hub.publish("tenant-b", "incident.updated", { id: "two" });
    expect(first.send).toHaveBeenCalledOnce();
    expect(slow.close).toHaveBeenCalledWith(1013, "client backpressure");
  });
  it("extracts only the dedicated socket subprotocol token", () => {
    expect(accessTokenFromSocketProtocol("chat, aegis.header.payload.signature")).toBe("header.payload.signature");
    expect(accessTokenFromSocketProtocol("chat")).toBeNull();
  });
});
