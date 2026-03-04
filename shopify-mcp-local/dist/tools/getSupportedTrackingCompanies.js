import { z } from "zod";
import { SUPPORTED_TRACKING_COMPANIES, TRACKING_UI_LOCATION } from "../lib/trackingCompanies.js";
const GetSupportedTrackingCompaniesInputSchema = z.object({
    search: z.string().optional(),
    limit: z.number().default(250)
});
const getSupportedTrackingCompanies = {
    name: "get-supported-tracking-companies",
    description: "Get Shopify-supported tracking carriers that can be selected in the order fulfillment tracking UI",
    schema: GetSupportedTrackingCompaniesInputSchema,
    initialize() {
        // No Shopify API client required: this list mirrors Shopify's tracking UI options.
    },
    execute: async (input) => {
        const { search, limit } = input;
        const query = search?.trim().toLowerCase();
        const filtered = query
            ? SUPPORTED_TRACKING_COMPANIES.filter((name) => name.toLowerCase().includes(query))
            : SUPPORTED_TRACKING_COMPANIES;
        return {
            totalAvailable: SUPPORTED_TRACKING_COMPANIES.length,
            returned: limit >= 0 ? filtered.slice(0, limit) : filtered,
            uiLocation: TRACKING_UI_LOCATION,
            notes: [
                "Gebruik de vervoerdernaam exact zoals in deze lijst (capitalization matters).",
                "Deze waarden horen bij fulfillment-tracking, niet bij order customAttributes (Aanvullende gegevens)."
            ]
        };
    }
};
export { getSupportedTrackingCompanies };
