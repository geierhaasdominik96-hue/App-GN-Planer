import { describe, expect, it } from "vitest";
import { createInvitationToken, hashInvitationToken } from "./invitation-tokens.js";

describe("invitation tokens", () => {
  it("creates URL-safe tokens with sufficient entropy", () => {
    const first = createInvitationToken();
    const second = createInvitationToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("stores a deterministic hash instead of the invitation token", () => {
    const token = createInvitationToken();
    const hash = hashInvitationToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
  });
});
