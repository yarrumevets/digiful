import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { Page, Layout, Text, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
// Import Custom Code
import { authenticate } from "../shopify.server";
import { resJson } from "app/utils/utilities";
import { unsubscribeWebhook } from "app/utils/registerwebhook";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return resJson({ message: "success", vmId: process.env.VM_ID });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const res = await admin.graphql(`query { shop { id name } }`);
  const shopifyData = (await res.json()).data;
  const shopId = shopifyData.shop.id.split("/").pop();
  const actions = {
    unsubscribeWebhooks: async (webhookName: string) => {
      return {
        result: unsubscribeWebhook(shopId, admin, webhookName),
        webhookName: webhookName,
      };
    },
  } as const;
  const form = await request.formData();
  const actionType = form.get("actionType") as string;
  const handler = actions[actionType as keyof typeof actions];
  if (handler) return await handler(form.get("webhookName") as string);
  return null;
};

export default function Index() {
  const fetcher = useFetcher<typeof action>();
  const doWebhookUnsubscribe = (webhookName: string) => {
    const fd = new FormData();
    fd.append("actionType", "unsubscribeWebhooks");
    fd.append("webhookName", webhookName);
    fetcher.submit(fd, {
      method: "post",
    });
  };

  useEffect(() => {}, [fetcher.data]);
  useEffect(() => {
    doWebhookUnsubscribe("webhookOrdersPaid");
    doWebhookUnsubscribe("webhookAppSubscriptionsUpdate");
    doWebhookUnsubscribe("webhookAppUninstalled");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Page>
      <TitleBar title="digiful">Unsubscribe Webhooks</TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Text as="p">Unsubscribe Webhooks</Text>
            {fetcher.data && (
              <Text as="p">
                {fetcher.data.webhookName
                  ? `Unsubscribed: ${fetcher.data.webhookName}`
                  : "Unsubscribe failed"}
              </Text>
            )}
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
