import type { Session } from "@shopify/shopify-app-remix/server";
import type { ShopifyRestResources } from "node_modules/@shopify/shopify-api/dist/ts/rest/types";
import type { AdminApiContextWithRest } from "node_modules/@shopify/shopify-app-remix/dist/ts/server/clients";
import { mongoClientPromise } from "./mongoclient";
import { resJson } from "./utilities";
import { encrypt } from "app/utils/encrypt";

const MERCHANT_COLLECTION = "" + process.env.MERCHANT_COLLECTION;

// @TODO: - fix: api silently logs failure but does not retry
// - error handling - ex: json will throw if non-200 returned from shopify

export const registerWebhook = async (
  shopId: string,
  admin: AdminApiContextWithRest<ShopifyRestResources>,
  session: Session,
  webhookRoute: string,
  mongoSubsObjectName: string, // name of the object to store subs info in merchant.
  topic: string, // APP_SUBSCRIPTIONS_UPDATE
) => {
  const client = await mongoClientPromise;
  const db = client.db(process.env.DB_NAME);

  // Example data that is passed in:
  const webhookUrl = "" + process.env.WEBHOOK_URL + webhookRoute;

  const mongoData = await db
    .collection(MERCHANT_COLLECTION)
    .findOne({ shopId });
  // Check for existing webhook

  // @TODO: add try-catch

  // Get ALL webhooks and then manually filter, as some (APP_SUBSCRIPTIONS_UPDATE) don't work while others (ORDERS_PAID) do.
  const listResp = await admin.graphql(`
    query {
      webhookSubscriptions(first: 100) {
        edges {
          node {
            id
            topic
            callbackUrl
          }
        }
      }
    }
  `);

  const listData = await listResp.json();
  const sub = listData.data.webhookSubscriptions.edges
    .map((e: any) => e.node)
    .find((n: any) => n.callbackUrl === webhookUrl && n.topic === topic);

  console.log("~~~~~~~~~~~~~ LLLLLL: ", listData.data.webhookSubscriptions);

  console.log(`Register ${topic} webhook sub ID for shop#${shopId}: `, sub?.id);
  if (sub?.id) {
    return resJson({
      success: true,
      alreadyExisted: true,
    });
  }

  if (!mongoData?.[mongoSubsObjectName]?.id && session.accessToken) {
    const gqlResp = await admin.graphql(
      `mutation {
              webhookSubscriptionCreate(topic: ${topic}, webhookSubscription: { # <--- and here
                callbackUrl: "${webhookUrl}",
                format: JSON
              }) {
                webhookSubscription { 
                  id
                  topic
                  createdAt
                }
                userErrors { 
                  field 
                  message 
                }
              }
            }`,
    );
    const { data } = await gqlResp.json(); // @TODO: add try-catch
    if (data.webhookSubscriptionCreate.userErrors?.length) {
      console.error(
        "\u26A0\uFE0F  Webhook registration user errors: ",
        data.webhookSubscriptionCreate.userErrors,
      );
      await db.collection(MERCHANT_COLLECTION).updateOne(
        // @TODO: add try-catch
        { shopId },
        {
          $set: {
            [mongoSubsObjectName]: {
              errors: data.webhookSubscriptionCreate.userErrors,
            },
          },
        },
      );
    } else {
      const webhookData = data.webhookSubscriptionCreate.webhookSubscription;
      console.log("Webhook registration success: ", webhookData);
      webhookData.accessToken = encrypt(session.accessToken);
      await db.collection(MERCHANT_COLLECTION).updateOne(
        { shopId },
        {
          $set: { [mongoSubsObjectName]: webhookData },
        },
      );
    }
  }
  return resJson({
    success: true,
  });
};

export const unsubscribeAllWebhooks = async (
  accessToken: string,
  shopSlug: string,
  shopId: string,
) => {
  // Find all webhooks registered for this store.
  const response = await fetch(
    `https://${shopSlug}.myshopify.com/admin/api/2025-04/webhooks.json`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    },
  );
  const data = await response.json();
  const webhooks = data.webhooks;
  console.log(webhooks);

  // Unregister all webhooks
  for (const webhook of webhooks) {
    await fetch(
      `https://${shopSlug}.myshopify.com/admin/api/2025-04/webhooks/${webhook.id}.json`,
      {
        method: "DELETE",
        headers: {
          "X-Shopify-Access-Token": accessToken,
        },
      },
    );
  }
  // Archive old webhook data
  const client = await mongoClientPromise;
  const db = client.db(process.env.DB_NAME);
  const newDateString = new Date()
    .toISOString()
    .split("T")[0]
    .replace(/-/g, "_");
  const mongoArchiveResponse = await db
    .collection(MERCHANT_COLLECTION)
    .updateOne(
      { shopId },
      { $set: { [`archivedWebhooks.${newDateString}`]: webhooks } },
    );
  console.log("Mongo archive response: ", mongoArchiveResponse);
  // Delete records from the database
  const mongoRemoveWebhooksResponse = await db
    .collection(MERCHANT_COLLECTION)
    .updateOne({ shopId }, { $set: { webhooks: {} } });
  console.log("Mongo remove webhooks response: ", mongoRemoveWebhooksResponse);
};

export const unsubscribeWebhook = async (
  shopId: string,
  admin: AdminApiContextWithRest<ShopifyRestResources>,
  webhookName: string,
) => {
  console.log("Unsubscribe for ", webhookName, " ( ", shopId, " ) ");

  const client = await mongoClientPromise;
  const db = client.db(process.env.DB_NAME);
  const mongoData = await db
    .collection(MERCHANT_COLLECTION)
    .findOne({ shopId });

  let webhookId; // ex: 'gid://shopify/WebhookSubscription/111111111111'

  console.log(
    "<><><><> mongoData: ",
    mongoData,
    " ----- webhookName: ",
    webhookName,
  );

  if (mongoData && mongoData.webhooks?.[webhookName]) {
    webhookId = mongoData.webhooks?.[webhookName].id;
  } else {
    return null; // Just return if not found.
  }

  // Remove the webhook.
  const query = `
    mutation webhookSubscriptionDelete($id: ID!) {
      webhookSubscriptionDelete(id: $id) {
        deletedWebhookSubscriptionId
        userErrors {
          field
          message
        }
      }
    }
  `;
  const response = await admin.graphql(query, {
    variables: { id: webhookId },
  });

  const responseJson = await response.json();

  console.log(
    `Remove webhook ${webhookName} - ${webhookId} -- response body: ${JSON.stringify(responseJson)}`,
  );

  const deletedIdConfirmed =
    responseJson?.data?.webhookSubscriptionDelete?.deletedWebhookSubscriptionId;

  if (deletedIdConfirmed === webhookId) {
    console.log("Webhook successfully unsubscribed.");
  } else {
    throw new Error("Webhook was found but NOT successfully removed.");
  }

  // Update the db:
  const mongoUpdateRes = await db.collection(MERCHANT_COLLECTION).updateOne(
    { shopId },
    {
      $unset: {
        [webhookName]: 1, // <--- need webhook name to be the value of what this variable holds, not "webhookName"
      },
    },
  );

  console.log("Webhook unsubscribe db update res: ", mongoUpdateRes);

  return resJson(responseJson);
};
