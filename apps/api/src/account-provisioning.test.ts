import { describe, expect, it } from "vitest";
import { createLoginIdBase, createNumericInitialPassword } from "./account-provisioning.js";

describe("createLoginIdBase", () => {
  it("builds a short login ID from first and last name", () => {
    expect(createLoginIdBase("Mia Mustermann")).toBe("mmustermann");
  });

  it("normalizes German characters", () => {
    expect(createLoginIdBase("Ömer Groß")).toBe("ogross");
  });

  it("creates a usable ID for a single short name", () => {
    expect(createLoginIdBase("Li")).toBe("lix");
  });
});

describe("createNumericInitialPassword", () => {
  it("creates an easy-to-type ten digit initial password", () => {
    const password = createNumericInitialPassword();
    expect(password).toMatch(/^[1-9][0-9]{9}$/);
  });

  it("does not repeat one fixed default password", () => {
    const passwords = new Set(Array.from({ length: 12 }, createNumericInitialPassword));
    expect(passwords.size).toBeGreaterThan(1);
  });
});
