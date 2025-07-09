import { Card, Layout, Page, Text, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { subscriptionPlans } from "./config/subscriptions";

export default function AdditionalPage() {
  return (
    <Page>
      <TitleBar title="Digiful | Plans" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="800">
              <BlockStack>
                <Text variant="headingXl" as="h4">
                  Plans
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
                      <Text variant="headingLg" as="h4">
                        📦 {plan.name}
                      </Text>

                      <Text as="p" variant="bodyMd">
                        {" "}
                        {plan.detailedDescription}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {" "}
                        *{plan.finePrint}
                      </Text>

                      <p>
                        {plan.currency === "CAD" || plan.currency === "USD"
                          ? "$"
                          : ""}
                        <strong> {plan.price}</strong> {plan.currency}/
                        {plan.frequency}
                      </p>
                    </BlockStack>
                  );
                })}
              </BlockStack>
              <BlockStack inlineAlign="end">
                <a href="https://aws.amazon.com/s3/">
                  <img
                    src="https://d0.awsstatic.com/logos/powered-by-aws.png"
                    alt="Powered by AWS Cloud Computing"
                    style={{ width: "100px" }}
                    loading="lazy"
                    decoding="async"
                  />
                </a>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
