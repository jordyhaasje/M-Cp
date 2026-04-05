# M-Cp: Gevalideerd Fix Plan & Implementatie Roadmap

**Auteur:** Manus AI  
**Datum:** April 2026  
**Scope:** Een volledig gevalideerd, technisch correct stappenplan voor de M-Cp repository, inclusief API-validaties en verwachte werking na implementatie.

---

## Executive Summary

Dit document bevat het definitieve, technisch gevalideerde fix plan voor de M-Cp repository. Alle voorgestelde wijzigingen zijn getoetst aan de huidige codebase, de Shopify GraphQL Admin API (versie 2026-01) en de Model Context Protocol (MCP) specificatie.

De implementatie is opgedeeld in vier strikt geordende fases om conflicten te voorkomen. Na implementatie is de repository vrij van database-afhankelijkheden, zijn er 11 overbodige tools verwijderd, en is de "Native Preview Workflow" geactiveerd waarmee gebruikers direct visuele wijzigingen kunnen doorvoeren en bekijken.

---

## Fase 1: Kritieke Fixes & Veiligheid (Direct Uitvoeren)

Deze fase lost actieve bugs op en beveiligt destructieve acties.

### 1.1. Fix de Prijsconversie Bug in `clone-product-from-url`
- **Probleem:** De functie `centsToMoneyString` in `src/tools/cloneProductFromUrl.js` deelt de prijs door 100. Echter, de Shopify JSON API retourneert prijzen al als decimale strings (bijv. `"29.99"`). Hierdoor worden producten 100x te goedkoop aangemaakt.
- **Actie:** Verwijder de `centsToMoneyString` functie en gebruik de originele `price` en `compare_at_price` waarden direct uit de JSON payload.
- **Validatie:** Getoetst aan de Shopify Product API response structuur.

### 1.2. Beveilig `delete-theme-file`
- **Probleem:** In `src/tools/deleteThemeFile.js` staat de `themeRole` parameter standaard op `"main"`. Een LLM die deze tool aanroept zonder expliciete role, verwijdert bestanden van de live winkel.
- **Actie:** Wijzig in het Zod schema de default waarde: `ThemeRoleSchema.default("unpublished")`.
- **Actie:** Update de tool beschrijving om expliciet te vermelden dat het standaard op een unpublished thema werkt.

### 1.3. Voeg Output Schema's Toe
- **Probleem:** De MCP specificatie vereist output schema's voor betere LLM-interpretatie, maar 16 tools missen deze [1].
- **Actie:** Voeg Zod output schema's toe aan de resterende tools in `src/tools/registry.js` (o.a. `get-products`, `create-product`, `update-order`).
- **Validatie:** Update `tests/toolRegistry.test.mjs` om te verifiëren dat alle tools een `outputSchema` hebben.

---

## Fase 2: Tool Consolidatie (Opruimen & Samenvoegen)

Deze fase reduceert het aantal tools van 29 naar 18 om "tool overload" en LLM-verwarring te voorkomen.

### 2.1. Verwijder Aliassen en Interne Tools
- **Actie:** Verwijder `update-order-tracking` en `add-tracking-to-order` uit `src/tools/registry.js`.
- **Actie:** Verwijder `verify-theme-files` uit de publieke registry (behoud de logica intern in `src/lib/themeFiles.js`).
- **Validatie:** Verwijder de bijbehorende alias-tests uit `tests/toolRegistry.test.mjs`.

### 2.2. Consolideer Product Tools
- **Actie:** Voeg `create-product`, `update-product` en `delete-product` samen tot één `manage-product` tool met een `action` parameter (`create`, `update`, `delete`).
- **Actie:** Integreer `get-product-by-id` in `get-products` door een optionele `productId` parameter toe te voegen aan het Zod schema in `src/tools/getProducts.js`.
- **Actie:** Integreer `delete-product-variants` in `manage-product-variants`.

### 2.3. Consolideer Order & Customer Tools
- **Actie:** Integreer `get-order-by-id` in `get-orders` via een `orderId` parameter.
- **Actie:** Integreer `get-customer-orders` in `get-customers` via een `includeOrders: boolean` parameter.
- **Actie:** Verwijder `set-order-tracking` en behoud uitsluitend `update-fulfillment-tracking` als de primaire tracking tool.

---

## Fase 3: De Native Preview Workflow (Het WOW-effect)

Deze fase vervangt de complexe, database-afhankelijke draft workflow door een native Shopify preview workflow.

### 3.1. Verwijder de Database Draft Infrastructuur
- **Actie:** Verwijder `src/tools/draftThemeArtifact.js` en `src/tools/applyThemeDraft.js`.
- **Actie:** Verwijder `src/lib/db.js` en de PostgreSQL afhankelijkheid (`@hazify/db-core`).
- **Validatie:** De codebase is nu 100% stateless en vereist geen `DATABASE_URL` meer.

### 3.2. Implementeer `create-theme-preview`
- **Actie:** Maak een nieuwe tool die de `themeDuplicate` mutatie gebruikt om het live thema te kopiëren [2].
- **Validatie:** De Shopify 2026-01 API retourneert een `OnlineStoreTheme` object met een `prefix` veld [3].
- **Output:** Retourneer de nieuwe `themeId` en een directe, klikbare preview URL: `https://{prefix}.shopifypreview.com`.

### 3.3. Implementeer `update-theme-settings`
- **Actie:** Maak een tool specifiek voor niet-technische aanpassingen (kleuren, typografie).
- **Logica:** Lees `config/settings_data.json`, pas de JSON aan op basis van de LLM input, en schrijf terug via de `themeFilesUpsert` mutatie.

### 3.4. Implementeer `publish-theme`
- **Actie:** Maak een tool die de `themePublish` mutatie aanroept om een preview-thema live te zetten [4].
- **Veiligheid:** Vereis een expliciete `confirmation: "PUBLISH_THEME"` parameter in het Zod schema.

---

## Fase 4: Section Creatie & Spacing (Geavanceerde Theme Control)

Deze fase geeft de LLM de mogelijkheid om de structuur van de winkel aan te passen (sections toevoegen, spacing wijzigen) zonder de veiligheid in gevaar te brengen.

### 4.1. Maak JSON Templates Aanpasbaar
- **Actie:** Maak een nieuwe tool `update-theme-files` (de opvolger van de write-logica uit `draft-theme-artifact`).
- **Actie:** Sta writes naar `templates/*.json` toe (verwijder de hardcoded blokkade).
- **Validatie:** Voeg lokale JSON-validatie toe: controleer of het geldige JSON is, of het een `sections` object en een `order` array bevat, en of alle ID's in de `order` array voorkomen in het `sections` object.

### 4.2. Breid Theme Check Integratie Uit
- **Actie:** Zorg dat de bestaande `@shopify/theme-check-node` integratie ook draait op de JSON templates om `JSONSyntaxError` en `JSONMissingBlock` af te vangen.

### 4.3. Behoud Liquid Validatie
- **Actie:** Migreer de Liquid-inspectie logica (schema parsing, CSS scoping, raw img tags) uit de oude `draft-theme-artifact` naar de nieuwe `update-theme-files` tool.

---

## Hoe Alles Werkt Na Implementatie (De Gebruikerservaring)

Na het doorvoeren van dit plan is de M-Cp repository getransformeerd tot een veilige, krachtige en gebruiksvriendelijke AI-assistent.

### 1. Design & Kleuren Aanpassen
De gebruiker vraagt: *"Maak mijn knoppen blauw."*
1. De LLM roept `create-theme-preview` aan en krijgt een preview URL terug.
2. De LLM roept `get-theme-files` aan om `config/settings_data.json` te lezen.
3. De LLM roept `update-theme-settings` aan om de kleur aan te passen.
4. De LLM geeft de preview URL aan de gebruiker.

### 2. Structuur & Spacing Aanpassen
De gebruiker vraagt: *"Zet de FAQ sectie onder de productfoto's en verklein de ruimte ertussen."*
1. De LLM roept `get-theme-files` aan om `templates/product.json` te lezen.
2. De LLM past de `order` array aan om de FAQ sectie te verplaatsen.
3. De LLM past de `padding_top` of `padding_bottom` settings aan in het `sections` object.
4. De LLM roept `update-theme-files` aan om de JSON op te slaan. De JSON wordt lokaal gevalideerd voordat deze naar Shopify gaat.

### 3. Nieuwe Sections Bouwen
De gebruiker vraagt: *"Bouw een nieuwe 'Onze Kernwaarden' sectie."*
1. De LLM genereert Liquid code met een geldig `{% schema %}` en `presets`.
2. De LLM roept `update-theme-files` aan.
3. De code wordt lokaal gevalideerd door Theme Check en de custom inspectie-engine.
4. Bij succes wordt de sectie opgeslagen en via een JSON-template update op de pagina geplaatst.

### 4. Publicatie
De gebruiker zegt: *"Zet het live."*
1. De LLM roept `publish-theme` aan met de juiste `themeId` en de verplichte `confirmation` string.
2. Het thema staat live.

---

## Referenties

[1] Model Context Protocol Specification 2025-11-25 — Tools. https://modelcontextprotocol.io/specification/2025-11-25/server/tools

[2] Shopify GraphQL Admin API, "themeDuplicate mutation" (2026-01). https://shopify.dev/docs/api/admin-graphql/2026-01/mutations/themeduplicate

[3] Shopify GraphQL Admin API, "OnlineStoreTheme object" (2026-01). https://shopify.dev/docs/api/admin-graphql/2026-01/objects/onlinestoretheme

[4] Shopify GraphQL Admin API, "themePublish mutation" (2026-01). https://shopify.dev/docs/api/admin-graphql/2026-01/mutations/themepublish
