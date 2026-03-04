# Tracking Workflow (Verplicht)

## Doel
Trackingnummer en vervoerder moeten in Shopify fulfillment-tracking worden gezet, nooit als aanvullende gegevens.

## Verplichte toolvolgorde
1. `get-order-by-id` (orderref mag `1004`, `#1004` of GID)
2. `get-supported-tracking-companies`
3. `set-order-tracking` (voorkeur) of `update-fulfillment-tracking`
4. `get-order-by-id` ter verificatie

## Succescriterium
- Nieuwe code staat in `order.tracking.shipments`
- Juiste vervoerder staat in fulfillment tracking
- Niet alleen in `customAttributes` of losse metafields

## Wat verboden is
- Trackingnummer alleen in aanvullende gegevens zetten
- Alleen "success" melden zonder readback-verificatie
