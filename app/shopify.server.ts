import "@shopify/shopify-app-remix/adapters/node";
import type { Session } from "@shopify/shopify-app-remix/server";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma"; // dev
import prisma from "./db.server";
// import { mongoClientPromise } from "./utils/mongoclient";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb"; // prod - needs npm install

// Session storage options differ in this setup for production and development.
const isProduction = process.env.NODE_ENV === "production";
const sessionStorageForEnv = isProduction
  ? new MongoDBSessionStorage(
      new URL("" + process.env.MONGODB_URL), // your MongoDB connection string
      "shopify_app", // database name
    )
  : new PrismaSessionStorage(prisma);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: sessionStorageForEnv,
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    // removeRest: true, // removed for the subscription logic.
  },
  hooks: {
    afterAuth: async ({ session }: { session: Session }) => {
      console.log("After Auth:");
      // console.log("- Access Token:", session.accessToken);
      // console.log("- Shop:", session.shop);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
