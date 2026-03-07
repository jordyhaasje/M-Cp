const SUPPORTED_TRACKING_COMPANIES = [
    "4PX",
    "99 Minutos",
    "Aeronet",
    "AGS",
    "Alliance Air Freight",
    "Amazon",
    "Amazon Logistics UK",
    "Amm Spedition",
    "An Post",
    "ANDREANI",
    "Anjun Logistics",
    "APC Postal Logistics",
    "APG eCommerce Solutions Ltd.",
    "Apple Express",
    "Aruba Post",
    "Asendia USA",
    "ASL Canada",
    "Australia Post",
    "Australia Post MyPost Business",
    "AxleHire",
    "Better Trucks",
    "Bonshaw",
    "Border Express",
    "Bpost",
    "Bpost international",
    "Canada Post",
    "Canpar Courier",
    "Cargo Expreso GT",
    "Cargo Expreso SV",
    "Caribou",
    "CDEK",
    "CDL",
    "CEVA logistics",
    "Chilexpress",
    "China EMS",
    "China Post",
    "Chit Chats",
    "Chronopost",
    "Chukou1",
    "CNE Express",
    "Colissimo",
    "Comingle",
    "Coordinadora",
    "Correios",
    "Correos",
    "Correos Express",
    "CTT",
    "CTT Express",
    "Cyprus Post",
    "Deliver It",
    "Delnext",
    "Deprisa",
    "DHL eCommerce",
    "DHL eCommerce Asia",
    "DHL Express",
    "DHL Global Mail Asia",
    "DHL Sweden",
    "Dimerco Express Group",
    "DoorDash",
    "DPD",
    "DPD Belgium",
    "DPD Germany",
    "DPD Hungary",
    "DPD Local",
    "DPD UK",
    "DTD Express",
    "DX",
    "Dynamex",
    "Eagle",
    "Emons",
    "Estafeta",
    "Estes",
    "Evri",
    "FedEx",
    "First Global Logistics",
    "First Line",
    "Fleet Optics",
    "FSC",
    "Fulfilla",
    "Gaash",
    "GLS US",
    "GoBolt",
    "GP Logistic Service",
    "Grupo ampm",
    "Guangdong Weisuyi Information Technology (WSE)",
    "Hanjin",
    "Heppner Internationale Spedition GmbH & Co.",
    "HR Parcel",
    "Iceland Post",
    "IDEX",
    "Interparcel",
    "Israel Post",
    "Japan Post",
    "Kerry Express Thailand",
    "La Poste Burkina Faso",
    "La Poste Colissimo",
    "Landmark Global",
    "Landmark Global Reference",
    "LaserShip",
    "Latin Logistics - Avianca",
    "Latvia Post",
    "Libya Post",
    "Lietuvos Paštas",
    "Logisters",
    "Lone Star Overnight",
    "M3 Logistics",
    "Maldives Post",
    "Mauritius Post",
    "Meteor Space",
    "Mondial Relay",
    "moovin",
    "MyTeamGE",
    "Naqel Express",
    "NCS",
    "New Zealand Post",
    "Ninja Van",
    "NonstopDelivery",
    "North Russia Supply Chain (Shenzhen) Co.",
    "NOX Germany",
    "Old Dominion Freight Line",
    "OnTrac",
    "OPT-NC",
    "Packeta",
    "Pago Logistics",
    "Pandion",
    "Pasar",
    "Passport",
    "Pilot Freight Services",
    "Ping An Da Tengfei Express",
    "Pitney Bowes",
    "Portal PostNord",
    "Poste Italiane",
    "PostNL Domestic",
    "PostNL International",
    "PostNord Denmark",
    "PostNord Norway",
    "PostNord Sweden",
    "Purolator",
    "Qxpress",
    "Qyun Express",
    "R+L Carriers",
    "Royal Mail",
    "Royal Shipments",
    "S.F International",
    "Sagawa",
    "SEKO Logistics",
    "Sendle",
    "Servientrega Ecuador",
    "SF Express",
    "SFC Fulfillment",
    "ShipBob",
    "SHREE NANDAN COURIER",
    "Singapore Post",
    "SmartCat",
    "Southwest Air Cargo",
    "Spee-Dee Delivery Service",
    "Sprinter",
    "StarTrack",
    "Step Forward Freight",
    "Surpost",
    "Swiship DE",
    "Swiss Post",
    "Tele Post",
    "TForce Final Mile",
    "Tinghao",
    "TNT",
    "TNT Reference",
    "TNT UK",
    "TNT UK Reference",
    "Toll IPEC",
    "Tuffnells Parcels Express",
    "United Delivery Service",
    "UPS",
    "UPS Canada",
    "USPS",
    "Venipak",
    "We Pick Up",
    "We Post",
    "Whistl",
    "Wizmo",
    "WMYC",
    "Xpedigo",
    "XPO Logistics",
    "XYY Logistics",
    "Yamato",
    "YDH",
    "YiFan Express",
    "YunExpress",
    "YYZ Logistics",
    "ヤマト運輸",
    "佐川急便",
    "日本郵便",
    "Overig"
];
const TRACKING_COMPANY_ALIASES = {
    "postnl": "PostNL Domestic",
    "post nl": "PostNL Domestic",
    "postnl domestic": "PostNL Domestic",
    "postnl international": "PostNL International",
    "post nord": "PostNord Sweden",
    "dhl": "DHL Express",
    "dhl ecommerce": "DHL eCommerce",
    "dpd local": "DPD Local",
    "fedex": "FedEx",
    "gls": "GLS US",
    "ups": "UPS",
    "usps": "USPS",
    "royalmail": "Royal Mail",
    "royal mail": "Royal Mail",
    "bpost": "Bpost",
    "chrono post": "Chronopost",
    "china post": "China Post",
    "sf": "SF Express",
    "sf express": "SF Express",
    "tnt": "TNT",
    "evri": "Evri",
    "ontrac": "OnTrac"
};
const TRACKING_UI_LOCATION = {
    orderPagePath: "Shopify Admin > Bestellingen > [Order] > Afgehandeld kaart > Meer fulfilmentacties > Tracking bewerken",
    fieldNames: {
        trackingNumber: "Trackingnummer",
        company: "Vervoerder"
    }
};
const normalizeCompanyKey = (value) => value.trim().toLowerCase();
const isSupportedTrackingCompany = (company) => {
    if (!company) {
        return false;
    }
    return SUPPORTED_TRACKING_COMPANIES.some((known) => known === company);
};
const resolveTrackingCompany = (company) => {
    if (!company) {
        return undefined;
    }
    const trimmed = company.trim();
    if (!trimmed) {
        return undefined;
    }
    // Shopify is case-sensitive for recognized names; keep exact match first.
    const exactMatch = SUPPORTED_TRACKING_COMPANIES.find((known) => known === trimmed);
    if (exactMatch) {
        return exactMatch;
    }
    const normalized = normalizeCompanyKey(trimmed);
    const alias = TRACKING_COMPANY_ALIASES[normalized];
    if (alias) {
        return alias;
    }
    const caseInsensitiveMatch = SUPPORTED_TRACKING_COMPANIES.find((known) => known.toLowerCase() === normalized);
    if (caseInsensitiveMatch) {
        return caseInsensitiveMatch;
    }
    return undefined;
};
const assertSupportedTrackingCompany = (company, fieldName = "trackingCompany") => {
    if (!company) {
        return undefined;
    }
    const resolved = resolveTrackingCompany(company);
    if (!resolved || !isSupportedTrackingCompany(resolved)) {
        throw new Error(`Unsupported ${fieldName} '${company}'. Use get-supported-tracking-companies and pick an exact carrier value.`);
    }
    return resolved;
};
export { SUPPORTED_TRACKING_COMPANIES, TRACKING_COMPANY_ALIASES, TRACKING_UI_LOCATION, isSupportedTrackingCompany, resolveTrackingCompany, assertSupportedTrackingCompany };
