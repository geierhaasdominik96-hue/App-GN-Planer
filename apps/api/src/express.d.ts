import type { Principal } from "./security.js";

declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

export {};
