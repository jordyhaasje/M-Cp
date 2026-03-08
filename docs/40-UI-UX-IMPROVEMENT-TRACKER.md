# UI/UX Improvement Tracker

Status: actief
Scope: `apps/hazify-license-service/src/views/pages.js`
Doel: onboarding en dashboard UX verbeteren zonder API-contracten of runtimegedrag te breken.

## Workstream 1: Onboarding kort en afvinkbaar
- [x] Eerdere setup-progress indicator verwijderd op verzoek (rollback)
- [x] Dashboard zonder setup-progress blijft functioneel
- [x] Geen setup-blockers toegevoegd in UX-flow
- [x] Validatie: onboarding en dashboard werken zonder regressie

## Workstream 2: Klikdoelen en leesbaarheid
- [x] Verhoog interactieve targets naar minimaal 44px waar nodig
- [x] Verhoog micro-typografie naar leesbaar baseline niveau
- [x] Houd mobile ergonomie intact
- [x] Validatie: primaire acties zijn visueel en fysiek makkelijker aan te klikken

## Workstream 3: Minder visuele ruis
- [x] Verminder overmatige gradients/schaduwen in dashboardsecties
- [x] Houd merkgevoel, maar met strakkere hiërarchie
- [x] Beperk decoratieve animatie op functionele schermen
- [x] Validatie: content en CTA's zijn sneller scanbaar

## Workstream 4: Empty states taakgericht
- [x] Voeg duidelijke empty states toe voor winkels en koppelingen
- [x] Eén primaire CTA per empty state
- [x] Schrijf copy: reden + eerstvolgende actie
- [x] Validatie: gebruiker weet direct wat te doen zonder extra uitleg

## Workstream 5: Setup-status bovenaan
- [x] Voeg compact statuspaneel toe (shop connected, token, actieve koppelingen)
- [x] Koppel status aan bestaande data-load in dashboard
- [x] Gebruik consistente status badges (ok/warn/pending)
- [x] Validatie: setup-health in 1 oogopslag zichtbaar

## Workstream 6: CTA-hiërarchie
- [x] Maak primaire acties eenduidig per pane/tab
- [x] Zet secundaire acties visueel terug
- [x] Vermijd concurrerende primaire knoppen in dezelfde context
- [x] Validatie: tab/pane heeft één duidelijke next step

## Workstream 7: Accessibility en keyboard flow
- [x] Versterk `:focus-visible` voor keyboardgebruik
- [x] Controleer ARIA-labels en tab-volgorde in modals/tabs
- [x] Voeg live-regio toe voor async feedback waar relevant
- [x] Validatie: basis keyboard flow werkt zonder muis

## Implementatiechecks
- [x] `npm run build`
- [x] `npm test`
- [x] `npm run test:e2e`

## Afronding
- [x] Tracker volledig afgevinkt
- [x] Korte changelog opgenomen in commit/oplevering
- [x] Rest-risico's benoemd

## Korte changelog
- Setup-voortgang is teruggedraaid; dashboard toont geen setup-progress paneel meer.
- Dashboard CTA-hiërarchie aangescherpt: per setup-tab één dominante primaire actie.
- Empty states toegevoegd voor winkels en actieve koppelingen, inclusief directe vervolgstap.
- Interactie-grootte/typografie verhoogd op kritieke controls.
- Toegankelijkheid verbeterd met focus rings, ARIA tab/tabpanel-koppeling, keyboard-tabnavigatie en live-regio voor meldingen.
- UI vereenvoudigd door decoratieve animatie/visuele ruis terug te brengen op functionele schermen.

## Rest-risico's
- Er is nog geen dedicated visuele regressietest; styling is functioneel gevalideerd via build/tests/e2e.
- Cross-browser pixel-perfect rendering (Safari/Firefox) is nog niet geverifieerd met screenshot-diffs.
