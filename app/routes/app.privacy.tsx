import { Card, Layout, List, Page, Text, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";

const resJson = (data: any) => {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
};

// Loader
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // return Response.json({ digitalProductTag: process.env.DIGITAL_PRODUCT_TAG });
  return resJson({ digitalProductTag: process.env.DIGITAL_PRODUCT_TAG });
};

export default function AdditionalPage() {
  const loaderData = useLoaderData<typeof loader>();
  const [digitalProductTag, setDigitalProductTag] = useState<string>("");
  useEffect(() => {
    setDigitalProductTag(loaderData.digitalProductTag);
  }, [loaderData]);

  return (
    <Page>
      <TitleBar title="Digiful | Privacy Policy" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingLg" as="h4">
                Privacy Policy
              </Text>
              <Text as="p" variant="bodyMd">
                Digiful only collects the minimum data required to operate
                properly:
              </Text>
              <List>
                <List.Item>
                  User emails used solely to send digital product links after
                  purchase.
                </List.Item>

                <List.Item>
                  Merchant products tagged{" "}
                  <strong>'{digitalProductTag}'</strong> used to associate them
                  with downloadable content.
                </List.Item>

                <List.Item>
                  Manually provided S3 credentials encrypted and only decrypted
                  for API calls.
                </List.Item>

                <List.Item>
                  Download statistics shown only to the merchant, not shared or
                  sold.
                </List.Item>

                <List.Item>
                  Other Shopify admin data only used as needed for core app
                  functionality. We do not sell your data, use it for AI
                  training, or share it externally. All data stays within
                  digiful and is handled securely.
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
        {/* <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Resources
              </Text>
              <List>
                <List.Item>
                  <Link
                    url="https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav"
                    target="_blank"
                    removeUnderline
                  >
                    App nav best practices
                  </Link>
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section> */}
      </Layout>
    </Page>
  );
}
