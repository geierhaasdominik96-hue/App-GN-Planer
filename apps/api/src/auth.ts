import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { pool } from "./database.js";
import { env } from "./env.js";

function createAuth(allowServerSideProvisioning: boolean) {
  return betterAuth({
    appName: "GN-Planer",
    database: pool,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.webOrigins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowServerSideProvisioning,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-gn-planer-client-ip"]
      },
      database: {
        generateId: () => randomUUID(),
        joins: true
      }
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        immutableUsername: true
      })
    ]
  });
}

// Nur diese Instanz wird als öffentliche HTTP-Route eingebunden.
export const auth = createAuth(false);

// Diese Instanz wird nie gemountet. Sie dient später ausschließlich geschützten
// Lehrer-Workflows zur serverseitigen Anlage von Schülerkonten.
export const provisioningAuth = createAuth(true);
