import assert from "assert";
import { createShopifyGraphqlClient, gql } from "../src/lib/shopifyGraphqlClient.js";

const originalFetch = global.fetch;
const calls = [];
let throttledAttempts = 0;

try {
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body);

    if (body.query.includes("RetryableQuery")) {
      throttledAttempts += 1;
      if (throttledAttempts === 1) {
        return new Response(
          JSON.stringify({
            errors: "Throttled",
          }),
          {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "0" },
          }
        );
      }
    }

    if (body.query.includes("BrokenQuery")) {
      return new Response(
        JSON.stringify({
          errors: [{ message: "Field does not exist" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        data: { shop: { name: "Hazify Test" } },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  const client = createShopifyGraphqlClient({
    domain: "unit-test.myshopify.com",
    accessToken: "shpat_test",
    apiVersion: "2026-01",
  });

  assert.equal(client.url, "https://unit-test.myshopify.com/admin/api/2026-01/graphql.json");
  assert.equal(client.requestConfig.headers["X-Shopify-Access-Token"], "shpat_test");

  const query = gql`
    query ShopName {
      shop {
        name
      }
    }
  `;
  const data = await client.request(query, { limit: 1 });
  assert.deepEqual(data, { shop: { name: "Hazify Test" } });
  assert.equal(calls[0].url, client.url);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["X-Shopify-Access-Token"], "shpat_test");
  assert.deepEqual(JSON.parse(calls[0].options.body).variables, { limit: 1 });

  await assert.rejects(
    () =>
      client.request(gql`
        query BrokenQuery {
          missingField
        }
      `),
    /Field does not exist/
  );

  const retryingClient = createShopifyGraphqlClient({
    domain: "unit-test.myshopify.com",
    accessToken: "shpat_test",
    apiVersion: "2026-01",
    retryBaseDelayMs: 1,
  });
  const retryData = await retryingClient.request(gql`
    query RetryableQuery {
      shop {
        name
      }
    }
  `);
  assert.deepEqual(retryData, { shop: { name: "Hazify Test" } });
  assert.equal(throttledAttempts, 2, "429 responses should be retried once before succeeding");
} finally {
  global.fetch = originalFetch;
}

console.log("shopifyGraphqlClient.test.mjs passed");
