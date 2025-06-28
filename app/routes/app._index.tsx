import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useFetcher, useLoaderData } from "@remix-run/react";
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
  DataTable,
  Tooltip,
  Icon,
  TextField,
} from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { mongoClientPromise } from "app/utils/mongoclient";
import { s3AddProduct } from "app/utils/s3";
import { decrypt } from "app/utils/encrypt";

// Constants to put in configs later @TODO
const dbName = "digiful";
const merchantCollection = "merchants";
const productCollection = "products";
const DIGITAL_PRODUCT_TAG = "digital-product";

// Loader
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Get Shopify GraphQL data:
  const { admin, session } = await authenticate.admin(request);
  const res = await admin.graphql(`query { shop { id name } }`);
  const shopifyData = (await res.json()).data;
  const shopName = shopifyData.shop.name;
  const shopDomain = session.shop;
  const shopSlug = shopDomain.replace(".myshopify.com", "");
  const shopId = shopifyData.shop.id.split("/").pop();
  // Get digiful MongoDB data:
  const client = await mongoClientPromise;
  const db = client.db(dbName);
  const mongoData = await db
    .collection(merchantCollection)
    .findOne({ shopId: shopId });
  // Create the user account document in Mongo if not found.
  if (!mongoData) {
    console.log("Creating new account...");
    const createAccountResult = await db
      .collection(merchantCollection)
      .insertOne({
        shopId: shopId,
        createdAt: new Date(),
        accountStatus: "Active",
      });
    if (createAccountResult.acknowledged === false) {
      console.error(
        "Error creating new MongoDB document for new user account!",
      );
    }
    // .... @TODO: make sure this works with the rest of the flow.
  }
  const createdAt =
    mongoData && "createdAt" in mongoData
      ? (mongoData.createdAt as Date)
      : undefined;
  const accountStatus =
    mongoData && "accountStatus" in mongoData
      ? (mongoData.accountStatus as string)
      : undefined;
  const s3CredsTestSuccess =
    mongoData && "s3CredsTestSuccess" in mongoData
      ? (mongoData.s3CredsTestSuccess as boolean)
      : null;
  const responseData: {
    shopName: string;
    shopSlug: string;
    shopId: string;
    createdAt: string;
    accountStatus: string;
    s3CredsTestSuccess: boolean | null;
  } = {
    shopName,
    shopSlug,
    shopId,
    createdAt:
      createdAt instanceof Date ? createdAt.toISOString() : (createdAt ?? ""),
    accountStatus: accountStatus || "",
    s3CredsTestSuccess,
  };
  return Response.json(responseData);
};

// Action
export const action = async ({ request }: ActionFunctionArgs) => {
  // Another way to get shopID
  // const { session } = await authenticate.admin(request);
  //const shopDomain = session.shop;
  // Get Shopify GraphQL data:
  const { admin } = await authenticate.admin(request); // { admin , session }
  const res = await admin.graphql(`query { shop { id name } }`);
  const shopifyData = (await res.json()).data;
  // const shopName = shopifyData.shop.name;
  const shopId = shopifyData.shop.id.split("/").pop();
  // const shopSlug = shopDomain.replace(".myshopify.com", "");
  const client = await mongoClientPromise;
  const db = client.db(dbName);
  const actions = {
    getAllDigitalProducts: async () => {
      const response = await admin.graphql(`
      query {
        products(first: 250, query: "tag:digital-product") {
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
      return Response.json(products);
    },
    addNewProduct: async (formData: FormData) => {
      const title = formData.get("newProdTitle");
      const file = formData.get("newProdFile");
      if (!title || !file) return { success: false };
      // 1) Add new product to S3
      const mongoData = await db
        .collection(merchantCollection)
        .findOne({ shopId });
      console.log("mongoData: ", mongoData); // ??
      if (!mongoData) {
        throw new Error("No MongoDB document found for this shopId");
      }
      const { s3secretAccessKey, s3AccessKeyId, s3bucketName, s3Region } =
        mongoData;
      const decryptedS3SecretAccessKey = decrypt(s3secretAccessKey);
      const fileObject = file as File;
      const arrayBuffer = await fileObject.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const s3AddProductResult = await s3AddProduct(
        s3AccessKeyId,
        decryptedS3SecretAccessKey,
        s3bucketName,
        s3Region,
        title.toString(),
        buffer,
        fileObject.type,
        fileObject.name,
      );
      console.log("....S3 added file? ", s3AddProductResult);
      if (s3AddProductResult.success !== true) {
        // @TODO: update logic when return value updated. Clean up this logic/err handling
        console.error("Error adding new product to S3 bucket.");
        return Response.json({ action: "addNewProduct", success: false });
      }
      const ETag = s3AddProductResult.ETag;
      // 2) Add to shopify store - get product ID, add tag 'digital_product',
      const shopifyResponse = await admin.graphql(
        `
        mutation productCreate($title: String!, $tags: [String!]) {
          productCreate(input: {
            title: $title
            tags: $tags
          }) {
            product {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            title: title.toString(),
            tags: [DIGITAL_PRODUCT_TAG],
          },
        } as any, // bypass type check
      );
      const shopifyCreateResData = await shopifyResponse.json();
      const errors = shopifyCreateResData.data.productCreate.userErrors;
      if (
        !shopifyCreateResData?.data?.productCreate?.product ||
        errors?.length > 0
      ) {
        console.error("Shopify product creation errors:", errors);
        throw new Error("Failed to create product");
      }
      const shopifyProductId =
        shopifyCreateResData.data.productCreate.product.id;
      // 3) Save new product to database
      const now = new Date();
      const insertData = {
        title,
        shopifyProductId: shopifyProductId.split("/").pop(),
        shopId,
        file: {
          name: fileObject.name,
          type: fileObject.type,
          size: fileObject.size,
          ETag: ETag,
        },
        fileVersionHistory: [
          {
            file: {
              name: fileObject.name,
              type: fileObject.type,
              size: fileObject.size,
              ETag: ETag,
              createdAt: now,
            },
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
      const insertResponse = await db
        .collection(productCollection)
        .insertOne(insertData);
      console.log(".....MongopDB added file? ", insertResponse);
      return Response.json({ action: "addNewProduct", success: true });
    },
  } as const;
  const form = await request.formData();
  const actionType = form.get("actionType") as string;
  const handler = actions[actionType as keyof typeof actions];
  if (handler) return await handler(form);
  return null;
};

// ----------------------------------- PAGE COMPONENT ------------------------------ //

export default function Index() {
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  // Table data to hold product info.
  type DigitalProducstTableRow = string[];
  const [digitalProductsTableData, setDigitalProductsTableData] = useState<
    DigitalProducstTableRow[]
  >([]); // add type

  // Wizard stuff
  const showWizard = false;
  const startWizard = () => {
    console.log("starting wizard...");
  };

  // Add new form
  const [newProdTitle, setNewProdTitle] = useState<string>("");

  // ✨ TOAST ✨
  useEffect(() => {
    shopify.toast.show("✨ DIGIFUL! ✨");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Get customer name:
  const { shopName, shopSlug, s3CredsTestSuccess } =
    useLoaderData<typeof loader>();

  // Get all shop products
  const getAllDigitalProducts = () => {
    fetcher.submit({ actionType: "getAllDigitalProducts" }, { method: "POST" });
  };
  useEffect(() => {
    if (fetcher.data) {
      console.log("DIGITAL PRODUCTS: ", fetcher.data);
      const rows: DigitalProducstTableRow[] = fetcher.data.map((dp: any) => {
        const dpNumericId = dp.id.split("/").pop();
        const productPageUrl = (
          <Link
            url={`https://admin.shopify.com/store/${shopSlug}/products/${dpNumericId}`}
          >
            {"View[↗]"}
          </Link>
        );
        return [dp.title, dpNumericId, productPageUrl, "No"];
      });
      setDigitalProductsTableData(rows);
    }
  }, [fetcher.data, shopSlug]);

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  return (
    <Page>
      <TitleBar title="digiful">
        <button
          variant="primary"
          onClick={() => {
            console.log("Some button was clicked!");
          }}
        >
          SOME BUTTON {shopName}
        </button>
      </TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <Image source="images/logos/digiful-logo-64.png" alt="Logo" />
                <Text variant="headingXl" as="h4">
                  digiful
                </Text>
              </div>

              <Card>
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text variant="headingXl" as="h4">
                      ➕ Add a New Digital Product
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd" alignment="center">
                      Upload a file to sell. We'll add it to your shop, make it
                      available to download, and link you to the product page to
                      fill in more details!
                    </Text>
                  </BlockStack>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">
                      Upload Digital Product
                    </Text>

                    {!s3CredsTestSuccess ? (
                      <Text as="h3">
                        {s3CredsTestSuccess === null ? "⚠️" : "❌"}
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
                        value="addNewProduct"
                      />
                      <BlockStack gap="600">
                        <TextField
                          autoComplete="off"
                          label="Product Title:"
                          name="newProdTitle"
                          value={newProdTitle}
                          onChange={setNewProdTitle}
                          disabled={!s3CredsTestSuccess}
                        />
                        <div>
                          <label htmlFor="file">Select File: &nbsp; </label>
                          <input
                            id="file"
                            type="file"
                            name="newProdFile"
                            disabled={!s3CredsTestSuccess}
                          />
                        </div>
                        <Button
                          disabled={!s3CredsTestSuccess}
                          loading={isLoading}
                          submit
                        >
                          Add New Digital Product
                        </Button>
                      </BlockStack>
                    </Form>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* <Card>
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text variant="headingXl" as="h4">
                      📈 Key Metrics / Analytics
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">
                      ...# files, # downloads, #downloads/user,
                      #downloads/file...
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card> */}

              <Card>
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
                        <Tooltip content="All products in your Shopify inventory with the tag 'digital-product'">
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
                    <Button loading={isLoading} onClick={getAllDigitalProducts}>
                      Load All Digital Products
                    </Button>

                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={["Product", "ID", "Product Page", "Synced"]}
                      rows={digitalProductsTableData}
                    />
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text variant="headingXl" as="h4">
                      ⚙️ Settings
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Link url="/app/settings" removeUnderline>
                      Change Settings
                    </Link>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* <Card>
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text variant="headingXl" as="h4">
                      💳 Account/Billing
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">
                      Account status Account ID Plan: basic Usage: 100MB
                      down/13MB up/40 downloads/6 uploads/36 emails Logout
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card> */}
              {/* 
              <Card>
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text variant="headingXl" as="h4">
                      👩🏽‍🔬 Testing
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">
                      Send test email Send test new product (create prod, save
                      details to Digiful db, upload file)
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card> */}

              {/* <Card>
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text variant="headingXl" as="h4">
                      📋 Activity Log
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">
                      ...recent: uploads, downloads, errors, new users, etc....
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card> */}

              {/* <Card>
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text variant="headingXl" as="h4">
                      💁🏻‍♂️ Help / Support
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">
                      Docs - Contact - How-to - Feedback
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card> */}

              {showWizard ? (
                <Card>
                  <BlockStack gap="500">
                    <BlockStack gap="200">
                      <Text variant="headingXl" as="h4">
                        🪄Setup Wizard
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">
                        Welcome to Dijiful! Let's get setup...
                      </Text>
                      <Button loading={isLoading} onClick={startWizard}>
                        Let's Begin
                      </Button>
                    </BlockStack>
                  </BlockStack>
                </Card>
              ) : (
                ""
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
              <Card>
                <Text as="p">Info:</Text>
                <List>
                  <List.Item>Shop: {shopName}</List.Item>
                </List>
              </Card>
              <Card>
                <Text as="p">Quick Links</Text>
                <List>
                  <List.Item>
                    <Link url="https://digiful.link" removeUnderline>
                      digiful.link
                    </Link>
                  </List.Item>
                  <List.Item>
                    <Link url="/app/help" removeUnderline>
                      Help
                    </Link>
                  </List.Item>
                </List>
              </Card>

              <Card>
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text variant="headingXl" as="h4">
                      Setup Checklist
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="p">✅ - Account Status: Active : 🙌</Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="p">✅ - S3 Credentials Provided: Yes</Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="p">
                      {s3CredsTestSuccess === true
                        ? "✅ - S3 Credential Test: Passed"
                        : s3CredsTestSuccess === null
                          ? "⚠️ - S3 Credential Test: Untested"
                          : "❌  - S3 Credential Test: Recent Test Failed"}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="p">🔲 - Upload a digital product file</Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
