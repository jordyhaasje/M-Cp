# Section Clone Quickstart
Doelgroep: eindgebruikers, LLM-clients en promptbouwers.

Gebruik dit document voor een **korte prompt** richting een LLM die met de Hazify MCP werkt. Gebruik `AGENTS.md` niet als eindgebruikersprompt.

## Ondersteunde routes
### Nieuwe section uit reference
- Interne flow: `analyze-reference-ui` -> `draft-theme-artifact`
- Dit is de standaardroute voor een nieuwe section op basis van een reference URL
- URL-first met image hint

### Bestaande theme edit
- Interne flow: `search-theme-files` -> `get-theme-file` -> `draft-theme-artifact`
- Gebruik deze route alleen wanneer je een bestaand theme-bestand wilt aanpassen

## Belangrijk om te weten
- Image-only cloning wordt nog niet ondersteund zonder extra multimodale stap.
- Standaard maakt de LLM alleen `sections/<handle>.liquid`.
- De LLM mag geen `templates/*.json` of `config/*.json` aanpassen om een section live te plaatsen.
- Merchants plaatsen de nieuwe section daarna zelf via de Shopify Theme Editor.

## Simpele prompt voor een nieuwe section
```text
Maak een Shopify section na op basis van deze reference URL: <URL>.
Gebruik een meegestuurde afbeelding alleen als extra visuele hint.
Draft alleen de section in een preview theme en plaats niets live.
```

## Simpele prompt voor een bestaande section-aanpassing
```text
Pas de bestaande Shopify section aan waar deze tekst of sectienaam in voorkomt: <tekst of sectienaam>.
Zoek eerst het juiste bestand, lees het daarna in en draft alleen de noodzakelijke wijziging.
```

## Wat de LLM idealiter doet
1. Bepaalt eerst of het om een nieuwe section of een bestaande edit gaat
2. Gebruikt zo min mogelijk toolcalls
3. Stopt bij een duidelijke blokkade, zoals image-only input zonder URL
4. Draft standaard één section file tenzij extra files echt nodig zijn
