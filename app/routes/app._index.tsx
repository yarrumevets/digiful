import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useFetcher,
  useLoaderData,
  useActionData,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  List,
  Link,
  Image,
  TextField,
  Checkbox,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

// Import Custom Code
import { authenticate } from "../shopify.server";
import { decrypt } from "app/utils/encrypt";
import { s3AddProduct, s3AddProductWithAppCreds } from "app/utils/s3";
import { mongoClientPromise } from "app/utils/mongoclient";

import { resJson } from "app/utils/utilities";

import { registerWebhook } from "app/utils/registerwebhook";

// // Handle errors with reload message.
// import { ErrorFallback } from "app/utils/errormsg";
// export function ErrorBoundary() {
//   return <ErrorFallback />;
// }

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const vmId = "" + process.env.VM_ID;
  console.log("<><><><><> VM_ID loaded:", vmId);
  // Get basic merchant data.
  const MERCHANT_COLLECTION = "" + process.env.MERCHANT_COLLECTION;
  const DIGITAL_PRODUCT_TAG = "" + process.env.DIGITAL_PRODUCT_TAG;
  const DB_NAME = "" + process.env.DB_NAME;
  const { admin, session } = await authenticate.admin(request);
  const res = await admin.graphql(`query { shop { id name } }`);
  const shopifyData = (await res.json()).data;
  const shopName = shopifyData.shop.name;
  const shopDomain = session.shop;
  const shopSlug = shopDomain.replace(".myshopify.com", "");
  const shopId = shopifyData.shop.id.split("/").pop();
  // Get merchant info from DB
  const client = await mongoClientPromise;
  const db = client.db(DB_NAME);
  const mongoData = await db
    .collection(MERCHANT_COLLECTION)
    .findOne({ shopId: shopId });
  // Verify merchant account exists.
  if (!mongoData) {
    console.error(`No accout found for merchant: ${shopSlug}`);
    // return Response.json({ error: "Account not found!" });
    return resJson({ error: "Account not found!", vmId });
  }
  // Subscription check
  const response = await admin.graphql(`
    query {
      appInstallation {
        activeSubscriptions {
          id
          status
          name
        }
      }
    }
`);
  const { data } = await response.json();
  const subs = data.appInstallation.activeSubscriptions;
  const hasActiveSubscription = subs.length > 0 && subs[0].status === "ACTIVE";
  console.log("!!!!!!!!!!!!!!!!!!! subs: ", subs);

  if (!hasActiveSubscription) {
    return { hasActiveSubscription: false, vmId };
  }

  // Has an active subscription at this point.
  const planName = subs[0].name;
  console.log("===== subs 0 : ", subs[0]);
  if (!mongoData.plan) {
    await db.collection(MERCHANT_COLLECTION).updateOne(
      { shopId: shopId },
      {
        $set: {
          plan: {
            planName: planName,
          },
        },
      },
    );
  }
  const hasAllAwsCreds =
    mongoData.s3 &&
    mongoData.s3.s3AccessKeyId &&
    mongoData.s3.s3SecretAccessKey &&
    mongoData.s3.s3SecretAccessKey.iv &&
    mongoData.s3.s3SecretAccessKey.content &&
    mongoData.s3.s3BucketName &&
    mongoData.s3.s3Region;

  // Prepare response data.
  const createdAt =
    mongoData && "createdAt" in mongoData
      ? (mongoData.createdAt as Date)
      : undefined;
  const accountStatus =
    mongoData && "accountStatus" in mongoData
      ? (mongoData.accountStatus as string)
      : undefined;
  const s3CredsTestSuccess =
    mongoData?.s3 && "s3CredsTestSuccess" in mongoData.s3
      ? (mongoData.s3.s3CredsTestSuccess as boolean)
      : null;
  const responseData: {
    shopName: string;
    shopDomain: string;
    shopSlug: string;
    shopId: string;
    createdAt: string;
    accountStatus: string;
    s3CredsTestSuccess: boolean | null;
    digitalProductTag: string;
    hasActiveSubscription: boolean;
    planName: string;
    hasAllAwsCreds: boolean;
    vmId: string;
  } = {
    shopName,
    shopDomain,
    shopSlug,
    shopId,
    createdAt:
      createdAt instanceof Date ? createdAt.toISOString() : (createdAt ?? ""),
    accountStatus: accountStatus || "Unknown",
    s3CredsTestSuccess: s3CredsTestSuccess,
    digitalProductTag: DIGITAL_PRODUCT_TAG,
    hasActiveSubscription,
    planName,
    hasAllAwsCreds,
    vmId,
  };

  // return Response.json(responseData);
  return resJson(responseData);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Constants
  const MERCHANT_COLLECTION = "" + process.env.MERCHANT_COLLECTION;
  const PRODUCTS_COLLECTION = "" + process.env.PRODUCTS_COLLECTION;
  const DIGITAL_PRODUCT_TAG = "" + process.env.DIGITAL_PRODUCT_TAG;
  const VARIANTS_COLLECTION = "" + process.env.VARIANTS_COLLECTION;
  const DB_NAME = "" + process.env.DB_NAME;
  const { session, admin } = await authenticate.admin(request);
  const res = await admin.graphql(`query { shop { id name } }`);
  const shopifyData = (await res.json()).data;
  const shopId = shopifyData.shop.id.split("/").pop();
  const client = await mongoClientPromise;
  const db = client.db(DB_NAME);
  const actions = {
    // registerOrdersPaidWebhook: async () => {
    //   const webhookUrl =
    //     "" + process.env.WEBHOOK_URL + process.env.ORDERS_PAID_ROUTE;
    //   const mongoData = await db
    //     .collection(MERCHANT_COLLECTION)
    //     .findOne({ shopId });
    //   // Check for existing webhook
    //   const listResp = await admin.graphql(
    //     `query {
    //       webhookSubscriptions(topics: [ORDERS_PAID], first: 10)
    //       {
    //         edges {
    //           node {
    //             id
    //             callbackUrl
    //           }
    //         }
    //       }
    //     }`,
    //   );
    //   const listData = await listResp.json();
    //   const sub = listData.data.webhookSubscriptions.edges
    //     .map((e: any) => e.node)
    //     .find((n: any) => n.callbackUrl === webhookUrl);
    //   if (sub?.id) {
    //     return resJson({
    //       action: "registerOrdersPaidWebhook",
    //       success: true,
    //       alreadyExisted: true, // @TODO: clean up return object.
    //     });
    //   }
    //   console.log("REGISTER NEW WEBHOOK.......");
    //   // @TODO: What if !mongoData and !session.accessToken ?
    //   if (!mongoData?.webhookOrdersPaid?.id && session.accessToken) {
    //     const gqlResp = await admin.graphql(
    //       `mutation {
    //         webhookSubscriptionCreate(topic: ORDERS_PAID, webhookSubscription: {
    //           callbackUrl: "${webhookUrl}",
    //           format: JSON
    //         }) {
    //           webhookSubscription {
    //             id
    //             topic
    //             createdAt
    //           }
    //           userErrors {
    //             field
    //             message
    //           }
    //         }
    //       }`,
    //     );
    //     const { data } = await gqlResp.json();
    //     if (data.webhookSubscriptionCreate.userErrors?.length) {
    //       console.error(
    //         "\u26A0\uFE0F  Webhook registration user errors: ",
    //         data.webhookSubscriptionCreate.userErrors,
    //       );
    //       await db.collection(MERCHANT_COLLECTION).updateOne(
    //         { shopId },
    //         {
    //           $set: {
    //             "webhooks.webhookOrdersPaid": {
    //               errors: data.webhookSubscriptionCreate.userErrors,
    //             },
    //           },
    //         },
    //       );
    //     } else {
    //       const webhookData =
    //         data.webhookSubscriptionCreate.webhookSubscription;
    //       webhookData.accessToken = encrypt(session.accessToken);
    //       await db
    //         .collection(MERCHANT_COLLECTION)
    //         .updateOne(
    //           { shopId },
    //           { $set: { "webhooks.webhookOrdersPaid": webhookData } },
    //         );
    //     }
    //   }
    //   return resJson({ action: "registerOrdersPaidWebhook", success: true });
    // },

    registerOrdersPaidWebhook: async () => {
      return registerWebhook(
        shopId,
        admin,
        session,
        "" + process.env.ORDERS_PAID_ROUTE,
        "webhooks.webhookOrdersPaid",
        "ORDERS_PAID",
      );
    },

    registerAppSubscriptionUpdateWebhook: async () => {
      return registerWebhook(
        shopId,
        admin,
        session,
        "" + process.env.APP_SUBSCRIPTIONS_UPDATE_ROUTE,
        "webhooks.webhookAppSubscriptionsUpdate", // mongo
        "APP_SUBSCRIPTIONS_UPDATE", // graphql enum
      );
    },

    registerAppUninstalledWebhook: async () => {
      return registerWebhook(
        shopId,
        admin,
        session,
        "" + process.env.APP_UNINSTALLED_ROUTE,
        "webhooks.webhookAppSubscriptionsUpdate", // mongo
        "APP_UNINSTALLED", // graphql enum
      );
    },

    getAllDigitalProductsFromShop: async () => {
      // Get all products from the Shopify store (not the DB) marked with the digital product tag.
      // @TODO: Add pagination. Currently limited to 250 products.
      const response = await admin.graphql(`
      query {
        products(first: 250, query: "tag:${DIGITAL_PRODUCT_TAG}") {
          edges {
            node {
              id
              title
              handle
              tags
            }
          }
        }
      }
    `);
      const data = await response.json();
      const products = data.data.products.edges.map(
        (e: { node: any }) => e.node,
      );
      // return Response.json(products);
      return resJson(products);
    },

    addNewDigitalProduct: async (formData: FormData) => {
      const title = formData.get("newProdTitle");
      const file = formData.get("newProdFile");
      const price = formData.get("newProdPrice"); // currency set at shop level
      const prodActive = formData.get("newProdActive");
      // const prodVariantTitle = formData.get("newProdVariantTitle");
      const newProdDescription = formData.get("newProdDescription");
      const status = prodActive === "true" ? "ACTIVE" : "DRAFT"; // or "ACHIVED"
      if (!title || !file) return { success: false };

      const mongoData: any = await db
        .collection(MERCHANT_COLLECTION)
        .findOne({ shopId });

      if (!mongoData) {
        throw new Error("No MongoDB document found for this shopId");
      }
      const merchantId = mongoData._id; // to store in product
      const shopPrefixHash = mongoData.shopPrefixHash;
      const fileObject = file as File;
      const arrayBuffer = await fileObject.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      let s3AddProductResult;

      let fileName;

      const merchantHasOwnCreds =
        mongoData.s3 && mongoData.plan?.planName === "SelfHosting";
      if (merchantHasOwnCreds) {
        // Merchant has own creds, so, no need to prefix file name.
        const { s3SecretAccessKey, s3AccessKeyId, s3BucketName, s3Region } =
          mongoData?.s3;
        const decryptedS3SecretAccessKey = decrypt(s3SecretAccessKey);
        s3AddProductResult = await s3AddProduct(
          s3AccessKeyId,
          decryptedS3SecretAccessKey,
          s3BucketName,
          s3Region,
          title.toString(),
          buffer,
          fileObject.type,
          fileObject.name,
        );

        fileName = fileObject.name;
      } else {
        console.log("~~~~~~~~~~~~~~~~~~~~~~~ APP HOSTED!!! ");
        const prefixedFileName = shopPrefixHash + "_" + fileObject.name;
        console.log("<> prefixedFileName: ", prefixedFileName);
        s3AddProductResult = await s3AddProductWithAppCreds(
          title.toString(),
          buffer,
          fileObject.type,
          prefixedFileName,
        );

        fileName = prefixedFileName;
      }
      if (s3AddProductResult.success !== true) {
        // @TODO: update logic when return value updated. Clean up this logic/err handling
        console.error("Error adding new product to S3 bucket...");
        // return Response.json({
        //   action: "addNewDigitalProduct",
        //   success: false,
        // });
        return resJson({
          action: "addNewDigitalProduct",
          success: false,
        });
      }
      const ETag = s3AddProductResult.ETag;
      // Create the product in Shopify
      const addShopifyProductResponse = await admin.graphql(
        `
          mutation productCreate($title: String!, $tags: [String!],  $status: ProductStatus!, $descriptionHtml: String!) {
            productCreate(input: {
              title: $title
              tags: $tags
              status: $status
              descriptionHtml: $descriptionHtml
            }
          ) {
            product {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
        {
          variables: {
            title: title.toString(),
            tags: [DIGITAL_PRODUCT_TAG],
            status: status,
            descriptionHtml: newProdDescription,
          },
        } as any,
      );

      // First, get the Online Store publication ID
      const publicationsResponse = await admin.graphql(
        `
          query {
            publications(first: 10) {
              edges {
                node {
                  id
                  name
                }
              }
            }
          }`,
      );
      const addShopifyProductResponseData =
        await addShopifyProductResponse.json();
      // Parse the response
      const responseData = await publicationsResponse.json();
      // 1) Bulk create variant (price only)
      const bulkRes = await admin.graphql(
        `mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
            productVariants { id inventoryItem { id } price compareAtPrice taxable sku barcode }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            productId:
              addShopifyProductResponseData.data.productCreate.product.id,
            variants: [
              {
                price: price?.toString(),
                optionValues: [{ optionName: "Title", name: title }],
              },
            ],
          },
        },
      );
      const bulkData = (await bulkRes.json()).data.productVariantsBulkCreate;
      if (bulkData.userErrors.length)
        throw new Error(
          bulkData.userErrors.map((e: { message: any }) => e.message).join(),
        );
      const variant = bulkData.productVariants[0];

      // 2) Update shipping & inventory on the inventory item
      const updateRes = await admin.graphql(
        `mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
     inventoryItemUpdate(id: $id, input: $input) {
       inventoryItem { id tracked requiresShipping }
       userErrors { field message }
     }
   }`,
        {
          variables: {
            id: variant.inventoryItem.id,
            input: { tracked: false, requiresShipping: false },
          },
        },
      );
      const updateData = (await updateRes.json()).data.inventoryItemUpdate;
      if (updateData.userErrors.length)
        throw new Error(
          updateData.userErrors.map((e: { message: any }) => e.message).join(),
        );
      // const finalVariant = variant;

      // Find the Online Store publication
      const onlineStorePublication = responseData.data.publications.edges.find(
        (edge: any) => edge.node.name === "Online Store",
      );
      const onlineStorePublicationId = onlineStorePublication?.node.id;
      // Then publish it to Online Store
      const publishResponse = await admin.graphql(
        `
          mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
            publishablePublish(id: $id, input: $input) {
              userErrors {
                field
                message
              }
            }
          }`,
        {
          variables: {
            id: addShopifyProductResponseData.data.productCreate.product.id,
            input: [
              {
                publicationId: onlineStorePublicationId, // Online Store publication ID
              },
            ],
          },
        },
      );
      const publishResponseObj = await publishResponse.json();
      console.log("Publish Response: ", publishResponseObj);
      const errors =
        addShopifyProductResponseData.data.productCreate.userErrors;
      if (
        !addShopifyProductResponseData?.data?.productCreate?.product ||
        errors?.length > 0
      ) {
        console.error("Shopify product creation errors:", errors);
      }
      const shopifyProductId =
        addShopifyProductResponseData.data.productCreate.product.id;
      // Add product and variant to DB
      const now = new Date();
      const insertProductResponse = await db
        .collection(PRODUCTS_COLLECTION)
        .insertOne({
          title,
          shopifyProductId: shopifyProductId.split("/").pop(),
          shopId,
          merchantId, // mongodb merchant collection id
          createdAt: now,
          updatedAt: now,
        });
      const insertVariantResponse = await db
        .collection(VARIANTS_COLLECTION)
        .insertOne({
          shopifyVariantId: String(variant.id),
          // title: prodVariantTitle,
          shopifyProductId: shopifyProductId.split("/").pop(), // variant.product_id;
          shopId,
          price: variant.price,
          compareAtPrice: variant.compare_at_price,
          productId: insertProductResponse.insertedId, // digiful internal db
          taxable: variant.taxable,
          barcode: variant.barcode,
          sku: variant.sku,
          file: {
            name: fileName, // either with prefix hash (hosted) or not (self hosted)
            originalName: fileObject.name,
            type: fileObject.type,
            size: fileObject.size,
            ETag: ETag,
          },
          fileVersionHistory: [
            // @TODO: use this for update flow when adding updated files.
            {
              file: {
                name: fileName,
                originalName: fileObject.name,
                type: fileObject.type,
                size: fileObject.size,
                ETag: ETag,
              },
              createdAt: now,
            },
          ],
          createdAt: now,
          updatedAt: now,
        });
      console.log("Insert variant response: ", insertVariantResponse);
      // return Response.json({
      //   action: "addNewDigitalProduct",
      //   success: true,
      //   shopifyProductId,
      // });
      return resJson({
        action: "addNewDigitalProduct",
        success: true,
        shopifyProductId,
      });
    },
  } as const;
  const form = await request.formData();
  const actionType = form.get("actionType") as string;
  const handler = actions[actionType as keyof typeof actions];
  if (handler) return await handler(form);
  return null;
};

//////////////////////////////////////////////////[ PAGE COMPONENT ]////////////////////////////

export default function Index() {
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const actionData = useActionData<typeof action>();
  const loaderData = useLoaderData<typeof loader>();

  // Register/verify the orders_paid webhook.
  useEffect(() => {
    const fd = new FormData();
    fd.append("actionType", "registerOrdersPaidWebhook");
    fetcher.submit(fd, {
      method: "post",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register/verify the app_subscription_update webhook.
  useEffect(() => {
    const fd = new FormData();
    fd.append("actionType", "registerAppSubscriptionUpdateWebhook");
    fetcher.submit(fd, {
      method: "post",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loader data.
  const [hasActiveSubscription, setHasActiveSubscription] =
    useState<string>("");
  const [planName, setPlanName] = useState<string>("");
  // const [shopName, setShopName] = useState<string>("");
  const [shopSlug, setShopSlug] = useState<string>("");
  const [s3CredsTestSuccess, setS3CredsTestSuccess] = useState<boolean | null>(
    null,
  );
  // const [shopDomain, setShopDomain] = useState<string>("");
  // const [shopId, setShopId] = useState<string>("");
  // const [createdAt, setCreatedAt] = useState<string>("");
  // const [accountStatus, setAccountStatus] = useState<string>("");
  const [hasAllAwsCreds, setHasAllAwsCreds] = useState<boolean>(false);
  const [canAddNewProduct, setCanAddNewProduct] = useState<boolean>(false);

  const hasActiveSub = loaderData.hasActiveSubscription;
  useEffect(() => {
    // @TODO: verify this is needed.
    setHasActiveSubscription(hasActiveSub);
  }, [hasActiveSub]);

  // Get form data
  useEffect(() => {
    setHasActiveSubscription(loaderData.hasActiveSubscription);
    setPlanName(loaderData.planName);
    // setShopName(loaderData.shopName);
    setShopSlug(loaderData.shopSlug);
    setS3CredsTestSuccess(loaderData.s3CredsTestSuccess);
    // setShopDomain(loaderData.shopDomain);
    // setShopId(loaderData.shopId);
    // setCreatedAt(loaderData.createdAt);
    // setAccountStatus(loaderData.accountStatus);
    setHasAllAwsCreds(loaderData.hasAllAwsCreds);
    setCanAddNewProduct(
      (loaderData.planName === "SelfHosting" &&
        loaderData.s3CredsTestSuccess) ||
        (loaderData.planName && loaderData.planName !== "SelfHosting"),
    );

    console.log("VM ID: ", loaderData.vmId, " --- loaderData: ", loaderData);
  }, [loaderData]);

  // New product form
  const [newProdTitle, setNewProdTitle] = useState<string>("");
  const [newProdId, setNewProdId] = useState<string>("");
  const [newProdUrl, setNewProdUrl] = useState<string>("");
  const [newProdPrice, setNewProdPrice] = useState<string>("");
  const [newProdActive, setNewProdActive] = useState<boolean>(false);
  const [newProdDescription, setNewProdDescription] = useState<string>("");
  const [newProdFile, setNewProdFile] = useState<string>("");

  useEffect(() => {
    if (actionData) {
      console.log("action data...", actionData);
      if (actionData.action === "addNewDigitalProduct") {
        const newProdNumId = actionData.shopifyProductId.split("/").pop();
        shopify.toast.show("New Product Added!");
        setNewProdId(newProdNumId);
        setNewProdUrl(
          `https://admin.shopify.com/store/${shopSlug}/products/${newProdNumId}`,
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);

  // Adding new product response
  useEffect(() => {
    shopify.toast.show("✨ DIGIFUL! ✨");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // @TODO - Feature - add this section to allow updating existing digital products
  // // Get all digital products section:
  // // Table data to hold product info.
  // type DigitalProducstTableRow = string[];
  // const [digitalProductsTableData, setDigitalProductsTableData] = useState<
  //   DigitalProducstTableRow[]
  // >([]); // add type
  // // Get all shop products
  // const getAllDigitalProductsFromShop = () => {
  //   fetcher.submit(
  //     { actionType: "getAllDigitalProductsFromShop" },
  //     { method: "POST" },
  //   );
  // };
  // useEffect(() => {
  //   if (fetcher.data?.actionType === "getAllDigitalProductsFromShop") {
  //     console.log("DIGITAL PRODUCTS: ", fetcher.data);
  //     const rows: DigitalProducstTableRow[] = fetcher.data.map((dp: any) => {
  //       const dpNumericId = dp.id.split("/").pop();
  //       const productPageUrl = (
  //         <Link
  //           url={`https://admin.shopify.com/store/${shopSlug}/products/${dpNumericId}`}
  //         >
  //           {"View[↗]"}
  //         </Link>
  //       );
  //       return [dp.title, dpNumericId, productPageUrl, "No"];
  //     });
  //     setDigitalProductsTableData(rows);
  //   }
  // }, [fetcher.data, shopSlug]);

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  return (
    <Page>
      <TitleBar title="digiful">
        {/* <button
          variant="primary"
          onClick={() => {
            console.log("Some button was clicked!");
          }}
        >
          SOME BUTTON {shopName}
        </button> */}
      </TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <BlockStack gap="800">
              <BlockStack>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <Image source="images/logos/digiful-logo-64.png" alt="Logo" />
                  <Text variant="headingXl" as="h4">
                    digiful
                  </Text>
                </div>
              </BlockStack>
              {hasActiveSubscription ? (
                <BlockStack gap="500">
                  <Card>
                    <BlockStack gap="500">
                      <BlockStack gap="200">
                        <Text variant="headingXl" as="h4">
                          ✨ Add a New Digital Product
                        </Text>
                      </BlockStack>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingMd" alignment="center">
                          Upload a file to sell. We'll add it to your shop, make
                          it available to download, and link you to the new
                          product page!
                        </Text>
                      </BlockStack>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingMd">
                          Upload Digital Product
                        </Text>
                        {!canAddNewProduct ? (
                          <Text as="h3">
                            {canAddNewProduct === null ? "⚠️" : "⚠️"}
                            You must successfully test your S3 credentials in
                            <Link url="/app/settings" removeUnderline>
                              {" "}
                              settings{" "}
                            </Link>{" "}
                            before you can start adding products.
                          </Text>
                        ) : (
                          ""
                        )}
                        <Form method="post" encType="multipart/form-data">
                          <input
                            type="hidden"
                            name="actionType"
                            value="addNewDigitalProduct"
                          />
                          <BlockStack gap="600">
                            <TextField
                              autoComplete="off"
                              label="Product Title:"
                              name="newProdTitle"
                              value={newProdTitle}
                              onChange={setNewProdTitle}
                              disabled={!canAddNewProduct}
                            />
                            {/* <TextField
                          autoComplete="off"
                          label="Variant Title:"
                          name="newProdVariantTitle"
                          value={newProdVariantTitle}
                          onChange={setNewProdVariantTitle}
                          disabled={!canAddNewProduct}
                          placeholder="(optional)"
                        /> */}
                            <TextField
                              autoComplete="off"
                              label="Description:"
                              name="newProdDescription"
                              value={newProdDescription}
                              onChange={setNewProdDescription}
                              disabled={!canAddNewProduct}
                            />
                            <TextField
                              autoComplete="off"
                              label="Price:"
                              name="newProdPrice"
                              value={newProdPrice}
                              onChange={setNewProdPrice}
                              disabled={!canAddNewProduct}
                              placeholder="0.00"
                            />
                            <Checkbox
                              label="Make Active Now"
                              name="newProdActive"
                              value={newProdActive.toString()}
                              checked={newProdActive}
                              onChange={(checked) => {
                                setNewProdActive(checked);
                              }}
                              disabled={!canAddNewProduct}
                            ></Checkbox>
                            <div>
                              <label htmlFor="file">Select File: &nbsp; </label>
                              <input
                                id="file"
                                type="file"
                                name="newProdFile"
                                disabled={!canAddNewProduct}
                                onChange={(e) => {
                                  const f = e.target.value
                                    ? e.target.value.split(`\\`).pop()
                                    : "";
                                  setNewProdFile(f as string);
                                }}
                              />
                            </div>
                            <Button
                              disabled={
                                !canAddNewProduct ||
                                !newProdPrice ||
                                !newProdTitle ||
                                !newProdDescription ||
                                !newProdFile
                              }
                              loading={isLoading}
                              submit
                            >
                              Add New Digital Product
                            </Button>
                          </BlockStack>
                        </Form>
                      </BlockStack>
                      <BlockStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Note: This is not an full-featured alternative to
                          Shopify's Add Product page. After adding your product,
                          go to the product page to fill in more details.
                        </Text>
                      </BlockStack>
                      {!!newProdId && !!newProdUrl ? (
                        <BlockStack>
                          <Text as="h3" variant="headingMd">
                            Your new product has been added!
                          </Text>
                          <Text as="p">
                            Your new product has been added. Go to the{" "}
                            <Link url={newProdUrl} target="_blank">
                              product page [&#8599;]
                            </Link>{" "}
                            to continue filling out your product information.
                          </Text>
                        </BlockStack>
                      ) : (
                        ""
                      )}
                    </BlockStack>
                  </Card>
                  {/* <Card>
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text variant="headingXl" as="h4">
                      🗄️ Manage Digital Products
                    </Text>
                  </BlockStack>
                  <BlockStack>
                    <Text as="h3" variant="headingMd" alignment="center">
                      <span>
                        Load all products from your shop marked as digital
                        products.
                        <Tooltip
                          content={`All products in your Shopify inventory with the tag '${digitalProductTag}'`}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              marginLeft: "-3px",
                            }}
                          >
                            <Icon source={InfoIcon} tone="subdued" />
                          </span>
                        </Tooltip>
                      </span>
                    </Text>
                    <Text as="h3" variant="headingMd" alignment="center">
                      Get an overview of which files have been added to digiful
                      and take action as needed.{" "}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Button
                      loading={isLoading}
                      onClick={getAllDigitalProductsFromShop}
                    >
                      Load All Digital Products
                    </Button>
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={["Product", "ID", "Product Page", "Synced"]}
                      rows={digitalProductsTableData}
                    />
                  </BlockStack>
                </BlockStack>
              </Card> */}
                </BlockStack>
              ) : (
                <BlockStack>
                  <BlockStack gap="500">
                    <Card>
                      <BlockStack gap="500">
                        <BlockStack gap="200">
                          <Text variant="headingXl" as="h4">
                            ✨ Choose a Plan
                          </Text>
                        </BlockStack>
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingMd" alignment="center">
                            You'll need a subscription to get started. Check out
                            the plans on the{" "}
                            <Link url="/app/settings" removeUnderline>
                              seetings page.
                            </Link>
                          </Text>
                        </BlockStack>
                      </BlockStack>
                    </Card>
                  </BlockStack>
                </BlockStack>
              )}
            </BlockStack>
          </Layout.Section>
          {/* RIGHT-SIDE */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              <Card>
                <BlockStack align="center">
                  <Image
                    source="images/logos/digiful-logo-256.png"
                    alt="Logo"
                  />
                  <Text variant="headingXl" as="h4" alignment="center">
                    digiful
                  </Text>
                </BlockStack>
              </Card>
              {/* <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h4">
                    Basic Info:
                  </Text>{" "}
                  <List>
                    <List.Item>Shop: {shopName}</List.Item>
                    <List.Item>URL: {shopDomain}</List.Item>
                    <List.Item>Shop ID: {shopId}</List.Item>
                    <List.Item>digiful account since: {createdAt}</List.Item>
                    <List.Item>Account Status: {accountStatus}</List.Item>
                    <List.Item>Digital Products: 0</List.Item>
                  </List>
                </BlockStack>
              </Card> */}
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h4">
                    Quick Links:
                  </Text>{" "}
                  <List>
                    <List.Item>
                      <Link
                        url="https://digiful.click"
                        removeUnderline
                        target="_blank"
                      >
                        digiful.click
                      </Link>
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text variant="headingXl" as="h4">
                      📝 Setup Checklist
                    </Text>
                    <Text as="p">
                      These steps are required in order to start selling your
                      digital products.
                    </Text>
                  </BlockStack>
                  {/* <BlockStack gap="200">
                    {accountStatus === "Initialized" ? (
                      <Text as="p">✔️ Account Status: Initialized</Text>
                    ) : (
                      <Text as="p">⚠️ Account Status: {accountStatus}</Text>
                    )}
                  </BlockStack> */}

                  <BlockStack>
                    {hasActiveSubscription ? (
                      <Text as="p">✔️ Subscription: {planName}</Text>
                    ) : (
                      <Text as="p">⚠️ Subscription: None</Text>
                    )}
                  </BlockStack>

                  {planName === "SelfHosting" ? (
                    <BlockStack gap="500">
                      <BlockStack gap="200">
                        {hasAllAwsCreds ? (
                          <Text as="p">✔️ S3 Credentials Provided</Text>
                        ) : (
                          <Text as="p">⚠️ S3 Credentials Not Provided</Text>
                        )}
                      </BlockStack>
                      <BlockStack gap="200">
                        <Text as="p">
                          {s3CredsTestSuccess === true
                            ? "✔️ S3 Credential Test: Passed"
                            : s3CredsTestSuccess === null
                              ? "⚠️ S3 Credential Test: Untested"
                              : "❌ S3 Credential Test: Recent Test Failed"}
                        </Text>
                      </BlockStack>
                    </BlockStack>
                  ) : (
                    ""
                  )}
                  {/* <BlockStack gap="200">
                    <Text as="p">🔲 - Upload a digital product</Text>
                  </BlockStack> */}
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
