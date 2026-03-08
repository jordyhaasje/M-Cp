import { gql } from "graphql-request";
const ORDER_GID_PREFIX = "gid://shopify/Order/";
const ORDER_LOOKUP_QUERY = gql `
  query lookupOrderByReference($query: String!) {
    orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
        }
      }
    }
  }
`;
const normalizeOrderNameToNumber = (name) => {
    if (!name) {
        return null;
    }
    return name.replace(/^#/, "").trim();
};
const extractOrderNumber = (input) => {
    const trimmed = input.trim();
    const direct = trimmed.match(/^#?(\d+)$/);
    if (direct) {
        return direct[1];
    }
    const embedded = trimmed.match(/(?:order|bestelling)\s*#?(\d+)/i);
    if (embedded) {
        return embedded[1];
    }
    return null;
};
const buildLookupQueries = (raw, orderNumber) => {
    const queries = [];
    const add = (query) => {
        if (query && !queries.includes(query)) {
            queries.push(query);
        }
    };
    const trimmed = raw.trim();
    const numericOnly = /^\d+$/.test(trimmed);
    if (numericOnly && trimmed.length >= 8) {
        add(`id:${trimmed}`);
    }
    if (orderNumber) {
        add(`name:${orderNumber}`);
        add(`name:#${orderNumber}`);
        add(`#${orderNumber}`);
    }
    add(trimmed);
    return queries;
};
const pickBestOrderMatch = (orders, rawInput, orderNumber) => {
    if (!orders.length) {
        return null;
    }
    if (orderNumber) {
        const exactByName = orders.find((order) => normalizeOrderNameToNumber(order.name) === orderNumber);
        if (exactByName) {
            return exactByName;
        }
    }
    if (/^\d+$/.test(rawInput)) {
        const exactByNumericId = orders.find((order) => order.id.endsWith(`/${rawInput}`));
        if (exactByNumericId) {
            return exactByNumericId;
        }
    }
    if (orders.length === 1) {
        return orders[0];
    }
    return null;
};
const resolveOrderIdentifier = async (shopifyClient, inputOrderId) => {
    const raw = String(inputOrderId || "").trim();
    if (!raw) {
        throw new Error("Order ID is required.");
    }
    if (raw.startsWith(ORDER_GID_PREFIX)) {
        return {
            id: raw,
            source: "gid",
            input: inputOrderId
        };
    }
    const orderNumber = extractOrderNumber(raw);
    const queries = buildLookupQueries(raw, orderNumber);
    for (const query of queries) {
        const response = (await shopifyClient.request(ORDER_LOOKUP_QUERY, {
            query
        }));
        const orders = (response.orders?.edges || []).map((edge) => edge.node).filter(Boolean);
        const match = pickBestOrderMatch(orders, raw, orderNumber);
        if (match) {
            return {
                id: match.id,
                source: "lookup",
                input: inputOrderId,
                matchedByQuery: query,
                matchedName: match.name
            };
        }
    }
    throw new Error(`Order '${inputOrderId}' not found. Use ordernummer (zoals #1004) of Shopify GID.`);
};
export { resolveOrderIdentifier };
