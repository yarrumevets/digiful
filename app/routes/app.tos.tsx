import { Card, Layout, Page, Text, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

// Handle errors with reload message.
import { ErrorFallback } from "app/utils/errormsg";
export function ErrorBoundary() {
  return <ErrorFallback />;
}

export default function AdditionalPage() {
  return (
    <Page>
      <TitleBar title="digiful | ToS" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingLg" as="h4">
                Terms of Service
              </Text>
              <Text as="p" variant="bodyMd">
                Users are responsible for uploaded content. Inappropriate or
                illegal use may result in termination of access.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
