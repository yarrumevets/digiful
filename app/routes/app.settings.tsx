import {
  Card,
  Layout,
  Button,
  Page,
  Text,
  BlockStack,
  Image,
  // Link,
  TextField,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useActionData,
  useFetcher,
} from "@remix-run/react";
import { authenticate } from "app/shopify.server";
import { mongoClientPromise } from "app/utils/mongoclient";
import { decrypt, encrypt } from "app/utils/encrypt";
import { s3CredsTest } from "app/utils/s3";

// Constants to put in configs later @TODO
const dbName = "digiful";
const merchantCollection = "merchants";

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

  // // Decrypt the stored s3 key
  // const s3secretAccessKey = mongoData?.s3secretAccessKey;
  // const decryptedKey = decrypt(s3secretAccessKey);
  // console.log("decrypted key: ", decryptedKey);

  const createdAt =
    mongoData && "createdAt" in mongoData
      ? (mongoData.createdAt as Date)
      : undefined;
  const accountStatus =
    mongoData && "accountStatus" in mongoData
      ? (mongoData.accountStatus as string)
      : undefined;
  const s3AccessKeyId =
    mongoData && "s3AccessKeyId" in mongoData
      ? (mongoData.s3AccessKeyId as string)
      : "";
  const s3bucketName =
    mongoData && "s3bucketName" in mongoData
      ? (mongoData.s3bucketName as string)
      : "";
  const s3secretAccessKey =
    mongoData && "s3secretAccessKey" in mongoData
      ? (mongoData.s3secretAccessKey as { iv: string; content: string })
      : { iv: "", content: "" };
  const s3Region =
    mongoData && "s3Region" in mongoData ? (mongoData.s3Region as string) : "";
  const s3CredsTestSuccess =
    mongoData && "s3CredsTestSuccess" in mongoData
      ? (mongoData.s3CredsTestSuccess as boolean)
      : null;

  // @TODO move this somewhere in utils ?
  const maskKey = (key: string) => {
    if (!key) return "";
    if (key.length <= 8) return "****";
    const start = key.slice(0, 3);
    const end = key.slice(-3);
    return `${start}**************${end}`;
  };

  const responseData: {
    shopName: string;
    shopSlug: string;
    shopId: string;
    createdAt: string;
    accountStatus: string;
    s3AccessKeyIdMasked: string;
    s3bucketName: string;
    hasS3SecretAccessKey: boolean;
    s3Region: string;
    s3CredsTestSuccess: boolean | null;
  } = {
    shopName,
    shopSlug,
    shopId,
    createdAt:
      createdAt instanceof Date ? createdAt.toISOString() : (createdAt ?? ""),
    accountStatus: accountStatus || "",
    s3AccessKeyIdMasked: maskKey(s3AccessKeyId),
    s3bucketName,
    hasS3SecretAccessKey:
      s3secretAccessKey?.iv.length > 0 && s3secretAccessKey?.content.length > 0,
    s3Region,
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
  // const shopSlug = shopDomain.replace(".myshopify.com", "");
  const shopId = shopifyData.shop.id.split("/").pop();
  const actions = {
    saveS3Settings: async (formData: FormData) => {
      const s3AccessKeyId = formData.get("s3AccessKeyId");
      const s3secretAccessKeyRaw = formData.get("s3secretAccessKey");
      const s3bucketName = formData.get("s3bucketName");
      const s3Region = formData.get("s3Region");
      const client = await mongoClientPromise;
      const db = client.db(dbName);
      const searchFor = { shopId };

      if (typeof s3secretAccessKeyRaw !== "string")
        throw new Error("Expected string");
      const s3secretAccessKey = encrypt(s3secretAccessKeyRaw);
      const upsertData = {
        s3AccessKeyId,
        s3secretAccessKey,
        s3bucketName,
        s3Region,
        s3CredsTestSuccess: null, // reset test results.
      };
      await db
        .collection(merchantCollection)
        .updateOne(searchFor, { $set: upsertData });
      return Response.json({ action: "saveS3Settings", success: true });
    },
    s3CredsTest: async () => {
      const client = await mongoClientPromise;
      const db = client.db(dbName);
      const mongoData = await db
        .collection(merchantCollection)
        .findOne({ shopId });
      if (!mongoData) {
        throw new Error("No MongoDB document found for this shopId");
      }
      const { s3secretAccessKey, s3AccessKeyId, s3bucketName, s3Region } =
        mongoData;
      // Decrypt the s3 secret access key
      const decryptedS3SecretAccessKey = decrypt(s3secretAccessKey);
      const s3CredsTestSuccess = await s3CredsTest(
        s3AccessKeyId,
        decryptedS3SecretAccessKey,
        s3bucketName,
        s3Region,
      );
      if (s3CredsTestSuccess) {
        // Save success
        await db
          .collection(merchantCollection)
          .updateOne({ shopId }, { $set: { s3CredsTestSuccess: true } });
      }
      return { action: "s3CredsTest", s3CredsTestSuccess: s3CredsTestSuccess };
    },
  } as const;

  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;

  console.log("ActionType: ", actionType);

  const handler = actions[actionType as keyof typeof actions];
  if (handler) return await handler(formData);
  return null;
};

// ------------------------------- The Settings Page Component --------------------------
export default function SettingsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const fetcher = useFetcher();
  const isLoading = fetcher.state === "submitting";

  // Handle the result of an action:
  const actionData = useActionData<typeof action>();

  const [s3AccessKeyId, setS3AccessKeyId] = useState<string>("");
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState<string>("");
  const [s3BucketName, setS3BucketName] = useState<string>("");
  const [s3Region, setS3Region] = useState<string>("");
  const [s3CredsTestSuccess, setS3CredsTestSuccess] = useState<boolean | null>(
    null,
  );
  const [s3AccessKeyIdMasked, setS3AccessKeyIdMasked] = useState<string>("");
  const [hasS3SecretAccessKey, setHasS3SecretAccessKey] =
    useState<boolean>(false);

  useEffect(() => {
    console.log("loader-data: ", loaderData);
    setS3AccessKeyId(loaderData.setS3AccessKeyId);
    setS3SecretAccessKey(loaderData.setS3SecretAccessKey);
    setS3BucketName(loaderData.s3bucketName);
    setS3Region(loaderData.s3Region);
    setS3CredsTestSuccess(loaderData.s3CredsTestSuccess);
    setS3AccessKeyIdMasked(loaderData.s3AccessKeyIdMasked);
    setHasS3SecretAccessKey(loaderData.hasS3SecretAccessKey);
  }, [loaderData]);

  useEffect(() => {
    if (actionData) {
      console.log("action data...", actionData);
      if (actionData.action === "s3CredsTest") {
        if (actionData.s3CredsTestSuccess) {
          shopify.toast.show("✅  S3 Credentials Test Successful");
        } else {
          shopify.toast.show("❌ S3 Credentials Test Failed");
        }
        setS3CredsTestSuccess(actionData.s3CredsTestSuccess);
      } else if (actionData.action === "saveS3Settings") {
        if (actionData.success) {
          shopify.toast.show("✅  S3 Credentials Updated Successfully");
        } else {
          shopify.toast.show("❌ Failed to update S3 credentials");
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);

  return (
    <Page>
      <TitleBar title="⚙️ Settings" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="600">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Image source="/images/logos/digiful-logo-64.png" alt="Logo" />
              <Text variant="headingXl" as="h4">
                digiful | settings
              </Text>
            </div>

            <Card>
              <BlockStack gap="1000">
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="headingXl" as="h4">
                      🪣 AWS Credentials (Required)
                    </Text>
                    <a href="https://aws.amazon.com/s3/">
                      <img
                        src="https://d0.awsstatic.com/logos/powered-by-aws.png"
                        alt="Powered by AWS Cloud Computing"
                        style={{ width: "100px" }}
                        loading="lazy"
                        decoding="async"
                      />
                    </a>
                  </InlineStack>
                  <Form method="post">
                    <BlockStack gap="200">
                      <input
                        type="hidden"
                        name="actionType"
                        value="saveS3Settings"
                      />
                      <TextField
                        label="S3 Access Key ID:"
                        name="s3AccessKeyId"
                        value={s3AccessKeyId}
                        placeholder={s3AccessKeyIdMasked}
                        onChange={setS3AccessKeyId}
                        autoComplete="off"
                        disabled={false}
                      />
                      <TextField
                        label="S3 Secret Access Key:"
                        name="s3secretAccessKey"
                        value={s3SecretAccessKey}
                        onChange={setS3SecretAccessKey}
                        placeholder={
                          hasS3SecretAccessKey
                            ? "****************************************"
                            : ""
                        }
                        autoComplete="off"
                        disabled={false}
                        type="password"
                      />
                      <TextField
                        label="S3 Bucket Name:"
                        name="s3bucketName"
                        value={s3BucketName}
                        onChange={setS3BucketName}
                        autoComplete="off"
                        disabled={false}
                      />

                      <TextField
                        label="S3 Region:"
                        name="s3Region"
                        value={s3Region}
                        onChange={setS3Region}
                        autoComplete="off"
                        disabled={false}
                      />

                      <Button
                        loading={isLoading}
                        disabled={
                          !(
                            s3AccessKeyId &&
                            s3SecretAccessKey &&
                            s3BucketName &&
                            s3Region
                          )
                        }
                        submit
                      >
                        Update
                      </Button>
                    </BlockStack>
                  </Form>
                </BlockStack>

                <BlockStack gap="500">
                  <BlockStack>
                    <Text variant="headingXl" as="h4">
                      {s3CredsTestSuccess === true
                        ? "✅ Credentials Test Passed!"
                        : s3CredsTestSuccess === null
                          ? "⚠️ Test Your S3 Credentials:"
                          : "❌ Credentials Test Failed: Update your credentials and try again."}
                    </Text>
                  </BlockStack>

                  <BlockStack>
                    <Form method="post">
                      <input
                        type="hidden"
                        name="actionType"
                        value="s3CredsTest"
                      />

                      <Button
                        disabled={
                          !(
                            s3AccessKeyIdMasked &&
                            hasS3SecretAccessKey &&
                            s3BucketName &&
                            s3Region
                          )
                        }
                        loading={isLoading}
                        submit
                      >
                        Run Credentials Test
                      </Button>
                    </Form>
                  </BlockStack>

                  <BlockStack>
                    <Text as="p">
                      Note: Create{" "}
                      <a
                        href="https://docs.aws.amazon.com/IAM/latest/UserGuide/security-creds.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--p-color-text-interactive)" }}
                      >
                        AWS credentials[↗]
                      </a>{" "}
                      with minimal necessary permissions. Grant read, write, and
                      delete access to your specific S3 bucket only.
                    </Text>
                    <Text as="p">Example:</Text>
                    <pre style={{ background: "#444", color: "#ccc" }}>
                      <code>
                        {`
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        "Resource": "arn:aws:s3:::your-bucket-name/*"
      }
    ]
  }
                        `}
                      </code>
                    </pre>
                  </BlockStack>
                </BlockStack>
              </BlockStack>
            </Card>
            {/* 
          <Card>
            <BlockStack gap="500">
              <BlockStack gap="200">
                <Text variant="headingXl" as="h4">
                  ⚙️ General Settings
                </Text>
                <Text as="h3" variant="headingMd">
                  How do you mark products as digital in Shopify?
                  <TextField
                    label="SKU contains this string:"
                    value={tagString}
                    onChange={setTagString}
                    autoComplete="off"
                    disabled={true}
                  />
                </Text>
                <Text as="h3" variant="headingMd">
                  Email Settings
                </Text>
                <TextField
                  label="Your custom email message"
                  value={emailMessage}
                  onChange={setEmailMessage}
                  autoComplete="off"
                  disabled={true}
                />
              </BlockStack>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="500">
              <BlockStack gap="200">
                <Text variant="headingXl" as="h4">
                  ⚠️ Danger Zone ⚠️
                </Text>
              </BlockStack>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Your Data:
                </Text>
                <Button loading={isLoading} onClick={doSettingsStuff}>
                  Download Your Data
                </Button>
                <Button
                  loading={isLoading}
                  variant="primary"
                  tone="critical"
                  onClick={doSettingsStuff}
                >
                  Delete Your data
                </Button>
                <Text as="h3" variant="headingMd">
                  Email:
                </Text>
                <Button
                  loading={isLoading}
                  onClick={doSettingsStuff}
                  tone="critical"
                >
                  Email Unsubscribe
                </Button>
                <Text as="h3" variant="headingMd">
                  Uninstall Digiful App:
                </Text>
                <Button
                  loading={isLoading}
                  variant="primary"
                  tone="critical"
                  onClick={doSettingsStuff}
                >
                  Uninstall
                </Button>
                <Link url="/app" removeUnderline>
                  Main Page
                </Link>
              </BlockStack>
            </BlockStack>
          </Card> */}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

declare module "@shopify/polaris";
