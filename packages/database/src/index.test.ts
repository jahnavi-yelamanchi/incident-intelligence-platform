import { describe, expect, it, vi } from "vitest";
import { withTenant, type DatabaseClient } from "./index";

describe("withTenant", () => {
  it("rejects an invalid organization id before opening a transaction", async () => {
    const client = { $transaction: vi.fn() } as unknown as DatabaseClient;

    await expect(withTenant(client, "not-a-uuid", vi.fn())).rejects.toThrow(
      "Invalid organization identifier",
    );
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
