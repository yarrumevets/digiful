// @TODO - Rename or copy this file to subscriptions.js, in this location.
// It will be gitignored upon renaming.

// Note:
// - s3: null should have selfHosted: true, and where s3 has values, selfHosted should be false or omitted.
// - They keys for each plan should be camel case versions of the name field.

const subscriptionPlans = {
  hostedBasic: {
    name: "HostedBasic",
    frequency: "month",
    price: 29.99,
    currency: "CAD",
    s3: {
      storageGb: 50,
      downloadGb: 50,
      maxDownloads: 50_000,
    },
    selfHosted: false, // Can omit this instead of explicit false.
    description: "YOUR BASIC DESCRIPTION",
    detailedDescription: "YOUR DETAILED DESCRIPTION",
    finePrint: "FINE PRINT",
  },
  selfHosting: {
    name: "SelfHosting",
    frequency: "month",
    price: 9.99,
    currency: "CAD",
    s3: null,
    selfHosted: true,
    description: "YOUR BASIC DESCRIPTION",
    detailedDescription: "YOUR DETAILED DESCRIPTION",
    finePrint: "FINE PRINT",
  },
};

const planNameLookup = {
  hostedBasic: "HostedBasic",
  HostedBasic: "hostedBasic",
  selfHosting: "SelfHosting",
  SelfHosting: "selfHosting",
};

export { subscriptionPlans, planNameLookup };
