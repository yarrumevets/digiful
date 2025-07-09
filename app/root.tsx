import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import crypto from "crypto";

import { mongoClientPromise } from "./utils/mongoclient";
import { authenticate } from "./shopify.server";

// Loader
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const MERCHANT_COLLECTION = "" + process.env.MERCHANT_COLLECTION;
  const DB_NAME = "" + process.env.DB_NAME;
  const { admin, session } = await authenticate.admin(request);
  const res = await admin.graphql(`query { shop { id name } }`);
  const shopifyData = (await res.json()).data;
  const shopName = shopifyData.shop.name;
  const shopDomain = session.shop;
  const shopSlug = shopDomain.replace(".myshopify.com", "");
  const shopId = shopifyData.shop.id.split("/").pop();
  // Get merchant info from db.
  const mongoClient = await mongoClientPromise;
  const db = mongoClient.db(DB_NAME);
  const mongoData = await db
    .collection(MERCHANT_COLLECTION)
    .findOne({ shopId: shopId });
  // Create the merchant document in db if not found.
  if (!mongoData) {
    // Get shop currency info
    console.log("Creating new account for ", shopSlug);
    const currencyQueryRes = await admin.graphql(
      `
      query {
        shop {
          currencyCode
          currencyFormats {
            moneyFormat
          }
        }
      }
    `,
    );
    const currencyQueryResData = await currencyQueryRes.json();
    const currency = currencyQueryResData?.data?.shop;
    // @TODO: move to plans logic as it is not needed when self hosting.
    // For prepending to filenames.
    const shopPrefixHash = crypto
      .createHash("sha256")
      .update(shopId)
      .digest("hex")
      .slice(0, 16);

    const createAccountResult = await db
      .collection(MERCHANT_COLLECTION)
      .insertOne({
        shopId: shopId, // 99999999999
        shopSlug, // 'quickstart-a1b2c3d4',
        shopName, // 'Quickstart (a1b2c3d4)',
        shopPrefixHash,
        accountStatus: "Initialized",
        currencyCode: currency.currencyCode, // 'CAD'
        currencyFormat: currency.currencyFormats.moneyFormat, // ${{amount}}
        createdAt: new Date(),
      });
    if (createAccountResult.acknowledged === false) {
      console.error(
        "Error inserting new account in MongoDB: ",
        createAccountResult,
      );
    }
  }

  return Response.json({});
};

export default function App() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
