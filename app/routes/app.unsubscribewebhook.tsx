import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { Page, Layout, Text, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
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
    unsubscribeAllWebhooks: async (webhookName: string) => {
      const results = await Promise.all([
        unsubscribeWebhook(shopId, admin, "webhookOrdersPaid"),
        unsubscribeWebhook(shopId, admin, "webhookAppSubscriptionsUpdate"),
        unsubscribeWebhook(shopId, admin, "webhookAppUninstalled"),
      ]);
      return {
        webhookOrdersPaid: results[0],
        webhookAppSubscriptionsUpdate: results[1],
        webhookAppUninstalled: results[2],
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

  const doWebhooksUnsubscribe = () => {
    const fd = new FormData();
    fd.append("actionType", "unsubscribeAllWebhooks");
    fetcher.submit(fd, {
      method: "post",
    });
  };

  const [webhooksList, setWebhooksList] = useState<string[] | null>([]);

  useEffect(() => {
    console.log("fetcher.data: ", fetcher.data);
    if (fetcher.data) {
      const webhookNames = Object.keys(fetcher.data);
      setWebhooksList(webhookNames);
    } else {
      setWebhooksList([]);
    }
  }, [fetcher.data]);

  useEffect(() => {
    doWebhooksUnsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  console.log("wh list: ", webhooksList);

  return (
    <Page>
      <TitleBar title="digiful"></TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Text as="h1">Unsubscribe Webhooks</Text>
            {
              /* {webhooksList.map((webhookListItem) => {
              return (
                <Text as="p" key={webhookListItem}>
                  Webhook: {webhookListItem}
                </Text>
              );
            })} */ ""
            }
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
