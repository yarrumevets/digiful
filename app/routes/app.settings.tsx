import {
  Card,
  Layout,
  Button,
  Page,
  Text,
  BlockStack,
  Image,
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

// Import Custom Code
import { authenticate } from "app/shopify.server";
import { mongoClientPromise } from "app/utils/mongoclient";
import { decrypt, encrypt } from "app/utils/encrypt";
import { s3CredsTest } from "app/utils/s3";
import { subscriptionPlans, planNameLookup } from "./config/subscriptions";
import { userFriendlyDate } from "app/utils/utilities";

const resJson = (data: any) => {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
};

// Loader
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const MERCHANT_COLLECTION = "" + process.env.MERCHANT_COLLECTION;
  const DB_NAME = "" + process.env.DB_NAME;

  // Get subscription/plan data
  const response = await admin.graphql(`
  query {
    appInstallation {
      activeSubscriptions {
        id
        status
        name,
        createdAt,
        currentPeriodEnd
      }
    }
  }
`);
  const subscriptionData = (await response.json()).data;
  const hasActiveSubscription =
    subscriptionData.appInstallation.activeSubscriptions.length > 0;

  console.log(
    "~~~~ ACTIVE SUBSCRIPTIONS IN SETTINGS: ",
    subscriptionData.appInstallation.activeSubscriptions,
  );

  let subscriptionStatus,
    planName,
    subscriptionCreatedAt,
    subscriptionCurrentPeriodEnd;
  if (hasActiveSubscription) {
    ({
      status: subscriptionStatus,
      name: planName,
      createdAt: subscriptionCreatedAt,
      currentPeriodEnd: subscriptionCurrentPeriodEnd,
    } = subscriptionData.appInstallation.activeSubscriptions[0]);
  }

  // Get Shopify data:
  const res = await admin.graphql(`query { shop { id name } }`);
  const shopifyData = (await res.json()).data;
  const shopName = shopifyData.shop.name;
  const shopDomain = session.shop;
  const shopSlug = shopDomain.replace(".myshopify.com", "");
  const shopId = shopifyData.shop.id.split("/").pop();
  // Get digiful MongoDB data:
  const client = await mongoClientPromise;
  const db = client.db(DB_NAME);
  const mongoData = await db
    .collection(MERCHANT_COLLECTION)
    .findOne({ shopId: shopId });

  const createdAt =
    mongoData && "createdAt" in mongoData
      ? (mongoData.createdAt as Date)
      : undefined;
  const accountStatus =
    mongoData && "accountStatus" in mongoData
      ? (mongoData.accountStatus as string)
      : undefined;
  const s3AccessKeyId =
    mongoData?.s3 && "s3AccessKeyId" in mongoData.s3
      ? (mongoData.s3.s3AccessKeyId as string)
      : "";
  const s3BucketName =
    mongoData?.s3 && "s3BucketName" in mongoData.s3
      ? (mongoData.s3.s3BucketName as string)
      : "";
  const s3SecretAccessKey =
    mongoData?.s3 && "s3SecretAccessKey" in mongoData.s3
      ? (mongoData.s3.s3SecretAccessKey as { iv: string; content: string })
      : { iv: "", content: "" };
  const s3Region =
    mongoData?.s3 && "s3Region" in mongoData.s3
      ? (mongoData.s3.s3Region as string)
      : "";
  const s3CredsTestSuccess =
    mongoData?.s3 && "s3CredsTestSuccess" in mongoData.s3
      ? (mongoData.s3.s3CredsTestSuccess as boolean)
      : null;

  console.log("s3 object: ", s3CredsTestSuccess);

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
    s3BucketName: string;
    hasS3SecretAccessKey: boolean;
    s3Region: string;
    s3CredsTestSuccess: boolean | null;
    // Subscription stuff.
    subscriptionStatus: string | null;
    planName: string | null;
    subscriptionCreatedAt: string | null;
    subscriptionCurrentPeriodEnd: string | null;
  } = {
    shopName,
    shopSlug,
    shopId,
    createdAt:
      createdAt instanceof Date ? createdAt.toISOString() : (createdAt ?? ""),
    accountStatus: accountStatus || "",
    s3AccessKeyIdMasked: maskKey(s3AccessKeyId),
    s3BucketName,
    hasS3SecretAccessKey:
      s3SecretAccessKey?.iv.length > 0 && s3SecretAccessKey?.content.length > 0,
    s3Region,
    s3CredsTestSuccess,
    subscriptionStatus,
    planName,
    subscriptionCreatedAt,
    subscriptionCurrentPeriodEnd,
  };

  // return Response.json(responseData);
  return resJson(responseData);
};

// --------------------------------- Action ----------------------------------------------
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request); // { admin , session }
  const DB_NAME = process.env.DB_NAME;
  const MERCHANT_COLLECTION = "" + process.env.MERCHANT_COLLECTION;
  const res = await admin.graphql(`query { shop { id name } }`);
  const shopifyData = (await res.json()).data;
  const shopId = shopifyData.shop.id.split("/").pop();

  const actions = {
    createSubscription: async (formData: FormData) => {
      const planKey = formData.get("subscriptionPlan") as string;
      // Validate.
      if (!(planKey in subscriptionPlans)) {
        // return Response.json({
        //   success: false,
        //   action: "createSubscription",
        //   error: "Plan not found",
        // });

        console.error("Plan key not found: ", planKey);

        return resJson({
          success: false,
          action: "createSubscription",
          error: "Plan not found",
        });
      }
      const plan = subscriptionPlans[planKey as keyof typeof subscriptionPlans];

      let returnUrl;

      if (process.env.NODE_ENV === "production") {
        // const host = new URL(request.url).searchParams.get("host");
        // returnUrl = `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?host=${host}`;
        // returnUrl = `${process.env.SHOPIFY_APP_URL}?shop=${session.shop}&host=${host}`;
        returnUrl = `https://admin.shopify.com/store/${session.shop.replace(".myshopify.com", "")}/apps/digiful/app`;
        console.log("----- RETURN URL: ", returnUrl);
      } else {
        // development.
        returnUrl =
          process.env.SHOPIFY_APP_URL +
          "?shop=" +
          session.shop +
          "&host=" +
          Buffer.from(session.shop + "/admin").toString("base64");
      }

      // @TODO: ! REMOVE test: true from here !
      const subscription = await admin.graphql(`
          mutation {
            appSubscriptionCreate(
              test: true
              name: "${plan.name}"
              returnUrl: "${returnUrl}"
              lineItems: [{
                plan: {
                  appRecurringPricingDetails: {
                    price: { amount: ${plan.price}, currencyCode: ${plan.currency} }
                  }
                }
              }]
            ) {
              confirmationUrl
            }
          }
        `);
      const result = await subscription.json();

      console.log("GraphQL subscription result:", result);
      // return Response.json({
      //   redirectUrl: result.data.appSubscriptionCreate.confirmationUrl,
      // });
      return resJson({
        redirectUrl: result.data.appSubscriptionCreate.confirmationUrl,
      });
    },
    cancelSubscription: async () => {
      const response = await admin.graphql(
        `query { appInstallation { activeSubscriptions { id } } }`,
      );
      const { data } = await response.json();
      const subscriptionId = data.appInstallation.activeSubscriptions[0].id;
      const cancelSubRes = await admin.graphql(`
        mutation {
          appSubscriptionCancel(id: "${subscriptionId}") {
            appSubscription { id status }
          }
        }
      `);
      const cancelSubResData = await cancelSubRes.json();
      console.log("RES 2 DATA: ", cancelSubResData); // @TODO: log and save in merchant DB.
      return null;
    },
    saveS3Settings: async (formData: FormData) => {
      const s3AccessKeyId = formData.get("s3AccessKeyId");
      const s3SecretAccessKeyRaw = formData.get("s3SecretAccessKey");
      const s3BucketName = formData.get("s3BucketName");
      const s3Region = formData.get("s3Region");
      const client = await mongoClientPromise;
      const db = client.db(DB_NAME);
      const searchFor = { shopId };
      if (typeof s3SecretAccessKeyRaw !== "string")
        throw new Error("Expected string");
      const s3SecretAccessKey = encrypt(s3SecretAccessKeyRaw);
      const upsertData = {
        s3: {
          s3AccessKeyId,
          s3SecretAccessKey,
          s3BucketName,
          s3Region,
          s3CredsTestSuccess: null, // reset test results.
        },
      };
      await db
        .collection(MERCHANT_COLLECTION)
        .updateOne(searchFor, { $set: upsertData });
      // return Response.json({ action: "saveS3Settings", success: true });
      return resJson({ action: "saveS3Settings", success: true });
    },
    s3CredsTest: async () => {
      const client = await mongoClientPromise;
      const db = client.db(DB_NAME);
      const mongoData = await db
        .collection(MERCHANT_COLLECTION)
        .findOne({ shopId });
      if (!mongoData) {
        throw new Error("No MongoDB document found for this shopId");
      }
      const { s3SecretAccessKey, s3AccessKeyId, s3BucketName, s3Region } =
        mongoData.s3;
      // Decrypt the s3 secret access key
      const decryptedS3SecretAccessKey = decrypt(s3SecretAccessKey);
      const s3CredsTestSuccess = await s3CredsTest(
        s3AccessKeyId,
        decryptedS3SecretAccessKey,
        s3BucketName,
        s3Region,
      );
      if (s3CredsTestSuccess) {
        // Save success
        await db
          .collection(MERCHANT_COLLECTION)
          .updateOne({ shopId }, { $set: { "s3.s3CredsTestSuccess": true } });
      }
      return { action: "s3CredsTest", s3CredsTestSuccess: s3CredsTestSuccess };
    },
  } as const;
  // Form response
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;
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
  const actionData = useActionData<typeof action>();
  // Redirect to the subscriptions form when user clicks a plan button.
  useEffect(() => {
    if (actionData?.redirectUrl) {
      console.log("--------- actionData: ", actionData);
      window.open(actionData.redirectUrl, "_top");
    }
  }, [actionData]);

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
  const [hasAllAwsCreds, setHasAllAwsCreds] = useState<boolean>(false);
  const [hasActiveSubscription, setHasActiveSubscription] =
    useState<boolean>(false);

  const [subscriptionStatus, setSubscriptionStatus] = useState<string>("");
  type PlanNameKey = keyof typeof planNameLookup;
  const [planName, setPlanName] = useState<PlanNameKey>("hostedBasic");
  const [subscriptionCreatedAt, setSubscriptionCreatedAt] =
    useState<string>("");
  const [subscriptionCurrentPeriodEnd, setSubscriptionCurrentPeriodEnd] =
    useState<string>("");
  type PlanDetails = {
    name: string;
    description: string;
    price: number;
    currency: string;
    frequency: string;
    selfHosted?: boolean;
    [key: string]: any;
  };
  const [planDetails, setPlanDetails] = useState<PlanDetails>(
    {} as PlanDetails,
  );

  useEffect(() => {
    setS3AccessKeyId(loaderData.setS3AccessKeyId);
    setS3SecretAccessKey(loaderData.setS3SecretAccessKey);
    setS3BucketName(loaderData.s3BucketName);
    setS3Region(loaderData.s3Region);
    setS3CredsTestSuccess(loaderData.s3CredsTestSuccess);
    setS3AccessKeyIdMasked(loaderData.s3AccessKeyIdMasked);
    setHasS3SecretAccessKey(loaderData.hasS3SecretAccessKey);
    setHasAllAwsCreds(
      !!loaderData.s3AccessKeyIdMasked &&
        !!loaderData.hasS3SecretAccessKey &&
        !!loaderData.s3BucketName &&
        !!loaderData.s3Region,
    );
    setHasActiveSubscription(loaderData.subscriptionStatus === "ACTIVE");
    setSubscriptionStatus(loaderData.subscriptionStatus);
    setPlanName(loaderData.planName);
    setSubscriptionCreatedAt(loaderData.subscriptionCreatedAt);
    setSubscriptionCurrentPeriodEnd(loaderData.subscriptionCurrentPeriodEnd);
    const lookupKey = planNameLookup[
      planName
    ] as keyof typeof subscriptionPlans;
    setPlanDetails(subscriptionPlans[lookupKey]);
  }, [loaderData, planName]);

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
                <BlockStack gap="400">
                  {hasActiveSubscription ? (
                    <BlockStack>
                      <Text variant="headingXl" as="h4">
                        Your Plan
                      </Text>
                      <Form method="post">
                        <input
                          type="hidden"
                          name="actionType"
                          value="cancelSubscription"
                        />

                        <ul>
                          <li>
                            Plan: <strong>{planName}</strong>
                          </li>
                          <li>
                            Subscription Status:{" "}
                            {subscriptionStatus === "ACTIVE"
                              ? "✅ Active"
                              : `⚠️${subscriptionStatus}`}
                          </li>
                          <li>
                            Created on:{" "}
                            {userFriendlyDate(subscriptionCreatedAt)}
                          </li>
                          <li>
                            Current period ending:{" "}
                            {userFriendlyDate(subscriptionCurrentPeriodEnd)}
                          </li>
                        </ul>
                        {planDetails ? (
                          <BlockStack>
                            <Text as="p">Plan details:</Text>
                            <ul>
                              <li>
                                {planDetails?.currency === "CAD" ||
                                planDetails?.currency === "USD"
                                  ? "$"
                                  : ""}
                                {planDetails?.price}
                                {planDetails?.currency} /{" "}
                                {planDetails?.frequency}
                              </li>
                              <li>{planDetails?.description}</li>
                            </ul>
                          </BlockStack>
                        ) : (
                          ""
                        )}
                        {/* @TODO: add a pop-up "Are you sure" confirmation before cancelling. */}
                        <Button submit variant="primary" tone="critical">
                          Cancel Subscription
                        </Button>
                      </Form>
                    </BlockStack>
                  ) : (
                    <BlockStack gap="600">
                      <BlockStack gap="400">
                        <BlockStack>
                          <Text variant="headingXl" as="h4">
                            🧾 Choose a Plan
                          </Text>
                        </BlockStack>
                        <BlockStack>
                          <Text variant="headingMd" as="h4" tone="critical">
                            ⚠️ You'll need a plan before you can start using
                            digiful ⚠️
                          </Text>
                        </BlockStack>
                        <BlockStack gap="800">
                          {Object.keys(subscriptionPlans).map((planKey) => {
                            const plan =
                              subscriptionPlans[
                                planKey as keyof typeof subscriptionPlans
                              ];
                            return (
                              <BlockStack gap="200" key={planKey}>
                                <Text variant="headingMd" as="h4">
                                  📦 {plan.name}
                                </Text>
                                <Form method="post">
                                  <p> {plan.description}</p>
                                  <p>
                                    {plan.currency === "CAD" ||
                                    plan.currency === "USD"
                                      ? "$"
                                      : ""}
                                    {plan.price}
                                    {plan.currency}/{plan.frequency}
                                  </p>
                                  <input
                                    type="hidden"
                                    name="actionType"
                                    value="createSubscription"
                                  />
                                  <input
                                    type="hidden"
                                    name="subscriptionPlan"
                                    value={planKey}
                                  />
                                  <Button submit>Get {plan.name}</Button>
                                </Form>
                              </BlockStack>
                            );
                          })}
                        </BlockStack>
                      </BlockStack>
                    </BlockStack>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Self hosting settings */}
            {planDetails?.selfHosted ? (
              <Card>
                <BlockStack gap="1000">
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="headingXl" as="h4">
                        🪣 AWS Credentials {hasAllAwsCreds}{" "}
                        {hasAllAwsCreds ? "✅" : "(Required)"}
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
                          name="s3SecretAccessKey"
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
                          name="s3BucketName"
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
                          disabled={!hasAllAwsCreds}
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
                        with minimal necessary permissions. Grant read, write,
                        and delete access to your specific S3 bucket only.
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
            ) : (
              ""
            )}

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
