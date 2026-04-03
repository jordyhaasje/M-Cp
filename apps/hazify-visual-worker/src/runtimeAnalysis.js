import { assertPublicHttpsUrlResolved } from "@hazify/mcp-common";

const VIEWPORT_PROFILES = [
  { id: "desktop", width: 1440, height: 1100 },
  { id: "tablet", width: 1024, height: 1180 },
  { id: "mobile", width: 390, height: 844 },
];

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function truncate(value, length = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, length);
}

function numericOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function firstNonEmpty(values) {
  return (values || []).find((value) => value !== null && value !== undefined && value !== "") ?? null;
}

function mergeProfileBooleans(profiles, key) {
  return (profiles || []).some((profile) => Boolean(profile?.[key]));
}

function pickProfile(profiles, id) {
  return (profiles || []).find((profile) => profile.profileId === id) || null;
}

function mergeRuntimeProfiles(profiles = []) {
  const desktop = pickProfile(profiles, "desktop");
  const tablet = pickProfile(profiles, "tablet");
  const mobile = pickProfile(profiles, "mobile");

  const sliderFeatures = {
    visibleSlidesDesktop: numericOrNull(desktop?.sliderFeatures?.visibleSlides),
    visibleSlidesTablet: numericOrNull(tablet?.sliderFeatures?.visibleSlides),
    visibleSlidesMobile: numericOrNull(mobile?.sliderFeatures?.visibleSlides),
    slideCount: Math.max(0, ...profiles.map((profile) => Number(profile?.sliderFeatures?.slideCount || 0))),
    slidesPerMove: Math.max(1, ...profiles.map((profile) => Number(profile?.sliderFeatures?.slidesPerMove || 1))),
    trackSelector: firstNonEmpty(profiles.map((profile) => profile?.sliderFeatures?.trackSelector)),
    slideSelector: firstNonEmpty(profiles.map((profile) => profile?.sliderFeatures?.slideSelector)),
    paginationStyle: firstNonEmpty(profiles.map((profile) => profile?.sliderFeatures?.paginationStyle)),
    arrowStyle: firstNonEmpty(profiles.map((profile) => profile?.sliderFeatures?.arrowStyle)),
    controlPlacement: firstNonEmpty(profiles.map((profile) => profile?.sliderFeatures?.controlPlacement)),
  };

  const iconFeatures = {
    hasInlineSvg: mergeProfileBooleans(profiles.map((profile) => profile.iconFeatures || {}), "hasInlineSvg"),
    inlineSvgSnippets: uniqueStrings(profiles.flatMap((profile) => profile?.iconFeatures?.inlineSvgSnippets || [])).slice(0, 8),
    iconImageSources: uniqueStrings(profiles.flatMap((profile) => profile?.iconFeatures?.iconImageSources || [])).slice(0, 12),
    iconPresentationMode: firstNonEmpty(profiles.map((profile) => profile?.iconFeatures?.iconPresentationMode)),
    logoAssets: uniqueStrings(profiles.flatMap((profile) => profile?.iconFeatures?.logoAssets || [])).slice(0, 12),
    decorativeIconCount: Math.max(0, ...profiles.map((profile) => Number(profile?.iconFeatures?.decorativeIconCount || 0))),
    functionalIconCount: Math.max(0, ...profiles.map((profile) => Number(profile?.iconFeatures?.functionalIconCount || 0))),
  };

  const controlFeatures = {
    hasPrevButton: profiles.some((profile) => profile?.controlFeatures?.hasPrevButton),
    hasNextButton: profiles.some((profile) => profile?.controlFeatures?.hasNextButton),
    hasDots: profiles.some((profile) => profile?.controlFeatures?.hasDots),
    buttonLabels: uniqueStrings(profiles.flatMap((profile) => profile?.controlFeatures?.buttonLabels || [])).slice(0, 12),
    buttonIcons: uniqueStrings(profiles.flatMap((profile) => profile?.controlFeatures?.buttonIcons || [])).slice(0, 12),
    ariaLabels: uniqueStrings(profiles.flatMap((profile) => profile?.controlFeatures?.ariaLabels || [])).slice(0, 12),
    paginationContainerSelector: firstNonEmpty(profiles.map((profile) => profile?.controlFeatures?.paginationContainerSelector)),
  };

  const interactiveFeatures = {
    hasSlider: profiles.some((profile) => profile?.interactiveFeatures?.hasSlider),
    hasCarousel: profiles.some((profile) => profile?.interactiveFeatures?.hasCarousel),
    hasTabs: profiles.some((profile) => profile?.interactiveFeatures?.hasTabs),
    hasAccordion: profiles.some((profile) => profile?.interactiveFeatures?.hasAccordion),
    hasAutoplay: profiles.some((profile) => profile?.interactiveFeatures?.hasAutoplay),
    hasLoop: profiles.some((profile) => profile?.interactiveFeatures?.hasLoop),
    hasScrollSnap: profiles.some((profile) => profile?.interactiveFeatures?.hasScrollSnap),
  };

  const animationFeatures = {
    transitionDurations: uniqueStrings(profiles.flatMap((profile) => profile?.animationFeatures?.transitionDurations || [])).slice(0, 12),
    timingFunctions: uniqueStrings(profiles.flatMap((profile) => profile?.animationFeatures?.timingFunctions || [])).slice(0, 12),
    transformPatterns: uniqueStrings(profiles.flatMap((profile) => profile?.animationFeatures?.transformPatterns || [])).slice(0, 12),
    hoverStates: uniqueStrings(profiles.flatMap((profile) => profile?.animationFeatures?.hoverStates || [])).slice(0, 12),
    entranceEffects: uniqueStrings(profiles.flatMap((profile) => profile?.animationFeatures?.entranceEffects || [])).slice(0, 12),
  };

  const runtimeLayoutSignals = {
    viewports: profiles.map((profile) => ({
      profileId: profile.profileId,
      viewport: profile.viewport,
      rootBox: profile.rootBox,
      hasHorizontalOverflow: Boolean(profile?.layout?.hasHorizontalOverflow),
      columnsEstimate: numericOrNull(profile?.layout?.columnsEstimate),
      repeatedItemCount: numericOrNull(profile?.layout?.repeatedItemCount),
      visibleSlides: numericOrNull(profile?.sliderFeatures?.visibleSlides),
      trackSelector: profile?.sliderFeatures?.trackSelector || null,
      slideSelector: profile?.sliderFeatures?.slideSelector || null,
    })),
  };

  return {
    runtimeLayoutSignals,
    interactiveFeatures,
    sliderFeatures,
    iconFeatures,
    controlFeatures,
    animationFeatures,
  };
}

function buildRuntimeError(error, code = "visual_runtime_unavailable") {
  return {
    success: false,
    errorCode: code,
    error: truncate(error?.message || error || "Runtime analysis unavailable."),
  };
}

async function loadPlaywright(context = {}) {
  if (typeof context.loadPlaywright === "function") {
    return context.loadPlaywright();
  }

  return import("playwright");
}

async function guardRequestUrl(url, cache) {
  if (cache.has(url)) {
    return cache.get(url);
  }

  try {
    await assertPublicHttpsUrlResolved(url);
    cache.set(url, true);
    return true;
  } catch {
    cache.set(url, false);
    return false;
  }
}

async function attachRouteGuard(browserContext) {
  const guardCache = new Map();
  await browserContext.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    if (!requestUrl.startsWith("https://")) {
      await route.abort();
      return;
    }

    const allowed = await guardRequestUrl(requestUrl, guardCache);
    if (!allowed) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}

async function collectViewportProfile({ browser, payload, viewport, timeoutMs, afterLoadWaitMs }) {
  const browserContext = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    screen: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });

  try {
    await attachRouteGuard(browserContext);
    const page = await browserContext.newPage();
    await page.goto(payload.url, {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    });
    await page.waitForTimeout(afterLoadWaitMs);

    return page.evaluate(
      ({ selector, profileId, viewportSize }) => {
        const root = selector ? document.querySelector(selector) : document.body;
        if (!root) {
          return {
            profileId,
            viewport: viewportSize,
            errorCode: "selector_not_found",
            error: `Selector '${selector}' kon niet gevonden worden in runtime analysis.`,
          };
        }

        const keywordRegex = /(slider|carousel|swiper|splide|embla|flickity|glide|marquee)/i;
        const dotRegex = /(dot|dots|bullet|pagination|pager|indicator)/i;
        const prevRegex = /(prev|previous|back|left)/i;
        const nextRegex = /(next|forward|right)/i;
        const logoRegex = /(logo|brand)/i;
        const iconRegex = /(icon|check|arrow|chevron|star|badge)/i;
        const tabRegex = /(tab|tabs)/i;
        const accordionRegex = /(accordion|collapse|faq)/i;
        const effectRegex = /(fade|slide|reveal|pulse|float|marquee|zoom)/i;

        const toText = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const truncate = (value, length = 240) => toText(value).slice(0, length);

        const isVisible = (element) => {
          if (!(element instanceof Element)) {
            return false;
          }
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        };

        const rectOf = (element) => {
          if (!(element instanceof Element)) {
            return null;
          }
          const rect = element.getBoundingClientRect();
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        };

        const cssPath = (element) => {
          if (!(element instanceof Element)) {
            return null;
          }
          if (element.id) {
            return `#${element.id}`;
          }

          const parts = [];
          let current = element;
          let depth = 0;
          while (current && current.nodeType === Node.ELEMENT_NODE && depth < 5 && current !== document.body) {
            let selector = current.tagName.toLowerCase();
            const classNames = Array.from(current.classList || []).slice(0, 2);
            if (classNames.length) {
              selector += `.${classNames.join(".")}`;
            }
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
              if (siblings.length > 1) {
                selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
              }
            }
            parts.unshift(selector);
            current = parent;
            depth += 1;
          }

          return parts.length ? parts.join(" > ") : element.tagName.toLowerCase();
        };

        const visibleElements = (elements) => Array.from(elements || []).filter((element) => isVisible(element));

        const trackCandidates = visibleElements(
          root.querySelectorAll(
            [
              "[data-slider]",
              "[data-carousel]",
              "[aria-roledescription*='carousel']",
              "[class*='slider']",
              "[class*='carousel']",
              "[class*='swiper']",
              "[class*='splide']",
              "[class*='embla']",
              "[class*='flickity']",
              "[class*='glide']",
              ".swiper",
              ".splide",
              ".embla",
            ].join(",")
          )
        );

        const rootStyle = window.getComputedStyle(root);
        const scrollSnapCandidate =
          rootStyle.scrollSnapType && rootStyle.scrollSnapType !== "none" ? root : null;
        const overflowCandidate = root.scrollWidth > root.clientWidth + 24 ? root : null;

        const normalizedTrackCandidates = [
          ...trackCandidates,
          ...(scrollSnapCandidate ? [scrollSnapCandidate] : []),
          ...(overflowCandidate ? [overflowCandidate] : []),
        ];

        const track =
          normalizedTrackCandidates.find((element) => {
            const style = window.getComputedStyle(element);
            const hasHorizontalOverflow = element.scrollWidth > element.clientWidth + 24;
            const hasTransform = style.transform && style.transform !== "none";
            const hasSnap = style.scrollSnapType && style.scrollSnapType !== "none";
            return hasHorizontalOverflow || hasTransform || hasSnap || keywordRegex.test(`${element.className} ${element.id}`);
          }) || null;

        let slides = [];
        if (track) {
          const childCandidates = visibleElements(track.children);
          slides = childCandidates.filter((element) => {
            const signature = `${element.className} ${element.id} ${element.getAttribute("role") || ""}`;
            return keywordRegex.test(signature) || /(slide|item|card|logo|review|testimonial)/i.test(signature);
          });
          if (!slides.length) {
            slides = childCandidates.filter((element) => element.getBoundingClientRect().width > 40);
          }
        }

        const trackBox = rectOf(track);
        const visibleSlides = slides.filter((slide) => {
          if (!trackBox) {
            return false;
          }
          const rect = slide.getBoundingClientRect();
          const overlapWidth = Math.min(rect.right, trackBox.x + trackBox.width) - Math.max(rect.left, trackBox.x);
          return overlapWidth > rect.width * 0.45;
        });

        const buttons = visibleElements(root.querySelectorAll("button, a[href], summary"));
        const prevButtons = buttons.filter((button) => {
          const label = toText(button.getAttribute("aria-label") || button.textContent || "");
          const signature = `${button.className} ${button.id} ${label}`;
          return prevRegex.test(signature) || /[<\u2039\u2190]/.test(label);
        });
        const nextButtons = buttons.filter((button) => {
          const label = toText(button.getAttribute("aria-label") || button.textContent || "");
          const signature = `${button.className} ${button.id} ${label}`;
          return nextRegex.test(signature) || /[>\u203a\u2192]/.test(label);
        });
        const dotButtons = buttons.filter((button) => {
          const label = toText(button.getAttribute("aria-label") || button.textContent || "");
          const signature = `${button.className} ${button.id} ${label}`;
          return dotRegex.test(signature) || /slide\s+\d+/i.test(label);
        });

        const tabList = root.querySelector("[role='tablist'], [class*='tabs']");
        const accordionNode = root.querySelector("details, [aria-expanded], [class*='accordion'], [class*='faq']");

        const svgNodes = visibleElements(root.querySelectorAll("svg")).slice(0, 8);
        const smallImages = visibleElements(root.querySelectorAll("img")).filter((element) => {
          const rect = element.getBoundingClientRect();
          const signature = `${element.className} ${element.id} ${element.getAttribute("alt") || ""}`;
          return rect.width <= 128 || rect.height <= 128 || iconRegex.test(signature) || logoRegex.test(signature);
        });
        const logoAssets = [
          ...visibleElements(root.querySelectorAll("[class*='logo'] img, [id*='logo'] img")).map((element) => element.currentSrc || element.getAttribute("src") || ""),
          ...svgNodes
            .filter((element) => logoRegex.test(`${element.className.baseVal || ""} ${element.closest("[class*='logo'], [id*='logo']")?.className || ""}`))
            .map((element) => truncate(element.outerHTML, 800)),
        ].filter(Boolean);

        const functionalIcons = [
          ...buttons.flatMap((button) => visibleElements(button.querySelectorAll("svg, img"))),
          ...visibleElements(root.querySelectorAll("[role='tab'] svg, [role='tab'] img")),
        ];

        const animationNodes = visibleElements(root.querySelectorAll("*"))
          .slice(0, 120)
          .filter((element) => {
            const style = window.getComputedStyle(element);
            return (
              (style.transitionDuration && style.transitionDuration !== "0s") ||
              (style.animationName && style.animationName !== "none") ||
              (style.transform && style.transform !== "none")
            );
          });

        const repeatedItems = visibleElements(
          root.querySelectorAll(
            [
              "[class*='card']",
              "[class*='tile']",
              "[class*='item']",
              "[class*='logo']",
              "article",
              "li",
            ].join(",")
          )
        ).slice(0, 12);
        const rowAnchors = repeatedItems
          .map((element) => rectOf(element))
          .filter(Boolean)
          .map((rect) => rect.y);
        const distinctRows = Array.from(new Set(rowAnchors.map((value) => Math.round(value / 16) * 16)));
        const topRow = repeatedItems
          .map((element) => rectOf(element))
          .filter((rect) => rect && distinctRows.length && Math.abs(rect.y - distinctRows[0]) <= 24);
        const columnsEstimate = topRow.length || (slides.length ? visibleSlides.length || 1 : 1);

        const detectArrowStyle = (navButtons) => {
          const signature = navButtons
            .map((button) => `${button.innerHTML} ${button.textContent} ${button.className}`)
            .join(" ");
          if (!signature) {
            return null;
          }
          if (/svg/i.test(signature)) {
            return "svg-icon";
          }
          if (/[<>\u2190\u2192\u2039\u203a]/.test(signature)) {
            return "text-arrow";
          }
          return "button-label";
        };

        const paginationStyle = dotButtons.length
          ? dotButtons.some((button) => button.querySelector("img"))
            ? "thumbnails"
            : dotButtons.some((button) => /\d+\s*\/\s*\d+/.test(button.textContent || ""))
            ? "fraction"
            : "dots"
          : null;

        const controlPlacement = (() => {
          const prevBox = rectOf(prevButtons[0]);
          const nextBox = rectOf(nextButtons[0]);
          const dotsBox = rectOf(dotButtons[0]?.parentElement || dotButtons[0]);
          if (trackBox && prevBox && nextBox) {
            if (prevBox.y >= trackBox.y && prevBox.y <= trackBox.y + trackBox.height) {
              return "inside-overlay";
            }
            if (prevBox.y > trackBox.y + trackBox.height && nextBox.y > trackBox.y + trackBox.height) {
              return "below";
            }
            return "outside";
          }
          if (trackBox && dotsBox && dotsBox.y > trackBox.y + trackBox.height) {
            return "below";
          }
          return null;
        })();

        const rootBox = rectOf(root);
        const textPreview = truncate(root.textContent || "", 180);

        return {
          profileId,
          viewport: viewportSize,
          rootBox,
          layout: {
            hasHorizontalOverflow: root.scrollWidth > root.clientWidth + 24 || Boolean(track && track.scrollWidth > track.clientWidth + 24),
            columnsEstimate,
            repeatedItemCount: repeatedItems.length,
            distinctRowCount: distinctRows.length,
            textPreview,
          },
          interactiveFeatures: {
            hasSlider: Boolean(track && slides.length >= 2),
            hasCarousel: Boolean(track && (slides.length >= 2 || prevButtons.length || nextButtons.length || dotButtons.length)),
            hasTabs: Boolean(tabList || root.querySelector("[role='tab']") || tabRegex.test(root.className || "")),
            hasAccordion: Boolean(accordionNode || accordionRegex.test(root.className || "")),
            hasAutoplay: /autoplay|auto-play|marquee/i.test(root.outerHTML.slice(0, 8000)),
            hasLoop: /loop|infinite/i.test(root.outerHTML.slice(0, 8000)),
            hasScrollSnap: Boolean(track && window.getComputedStyle(track).scrollSnapType !== "none"),
          },
          sliderFeatures: {
            visibleSlides: visibleSlides.length || null,
            slideCount: slides.length || null,
            slidesPerMove: slides.length > 1 ? 1 : null,
            trackSelector: track ? cssPath(track) : null,
            slideSelector: slides[0] ? cssPath(slides[0]) : null,
            paginationStyle,
            arrowStyle: detectArrowStyle([...prevButtons, ...nextButtons]),
            controlPlacement,
          },
          controlFeatures: {
            hasPrevButton: prevButtons.length > 0,
            hasNextButton: nextButtons.length > 0,
            hasDots: dotButtons.length >= 2,
            buttonLabels: Array.from(new Set([...prevButtons, ...nextButtons].map((button) => truncate(button.getAttribute("aria-label") || button.textContent || "", 80)).filter(Boolean))).slice(0, 8),
            buttonIcons: Array.from(
              new Set(
                [...prevButtons, ...nextButtons].flatMap((button) => {
                  const values = [];
                  if (button.querySelector("svg")) {
                    values.push("svg");
                  }
                  const label = button.textContent || "";
                  if (/[<\u2039\u2190]/.test(label)) {
                    values.push("arrow-left");
                  }
                  if (/[>\u203a\u2192]/.test(label)) {
                    values.push("arrow-right");
                  }
                  return values;
                })
              )
            ).slice(0, 8),
            ariaLabels: Array.from(new Set([...buttons].map((button) => truncate(button.getAttribute("aria-label") || "", 80)).filter(Boolean))).slice(0, 12),
            paginationContainerSelector: dotButtons[0]?.parentElement ? cssPath(dotButtons[0].parentElement) : null,
          },
          iconFeatures: {
            hasInlineSvg: svgNodes.length > 0,
            inlineSvgSnippets: svgNodes.map((element) => truncate(element.outerHTML, 900)),
            iconImageSources: Array.from(new Set(smallImages.map((element) => element.currentSrc || element.getAttribute("src") || "").filter(Boolean))).slice(0, 8),
            iconPresentationMode:
              svgNodes.length > 0
                ? "inline-svg"
                : smallImages.length > 0
                ? "image"
                : null,
            logoAssets: Array.from(new Set(logoAssets)).slice(0, 8),
            decorativeIconCount: Math.max(0, svgNodes.length + smallImages.length - functionalIcons.length),
            functionalIconCount: functionalIcons.length,
          },
          animationFeatures: {
            transitionDurations: Array.from(
              new Set(
                animationNodes
                  .map((element) => window.getComputedStyle(element).transitionDuration)
                  .filter((value) => value && value !== "0s")
              )
            ).slice(0, 8),
            timingFunctions: Array.from(
              new Set(
                animationNodes
                  .map((element) => {
                    const style = window.getComputedStyle(element);
                    return style.transitionTimingFunction !== "ease" ? style.transitionTimingFunction : style.animationTimingFunction;
                  })
                  .filter((value) => value && value !== "ease" && value !== "initial")
              )
            ).slice(0, 8),
            transformPatterns: Array.from(
              new Set(
                animationNodes
                  .map((element) => window.getComputedStyle(element).transform)
                  .filter((value) => value && value !== "none")
              )
            ).slice(0, 8),
            hoverStates: [],
            entranceEffects: Array.from(
              new Set(
                animationNodes.flatMap((element) => {
                  const values = [];
                  const style = window.getComputedStyle(element);
                  if (style.animationName && style.animationName !== "none") {
                    values.push(truncate(style.animationName, 80));
                  }
                  const className = typeof element.className === "string" ? element.className : element.className?.baseVal || "";
                  const classMatches = className.match(effectRegex);
                  if (classMatches) {
                    values.push(classMatches[0]);
                  }
                  return values;
                })
              )
            ).slice(0, 8),
          },
        };
      },
      {
        selector: payload.cssSelector || "body",
        profileId: viewport.id,
        viewportSize: {
          width: viewport.width,
          height: viewport.height,
        },
      }
    );
  } finally {
    await browserContext.close();
  }
}

export async function analyzeReferenceRuntime(payload, context = {}) {
  if (typeof context.runtimeAnalyze === "function") {
    return context.runtimeAnalyze(payload);
  }

  if (!payload?.url) {
    return buildRuntimeError("url is verplicht voor runtime analysis.", "visual_runtime_requires_url");
  }

  try {
    const { chromium } = await loadPlaywright(context);
    const timeoutMs = Number(process.env.HAZIFY_VISUAL_RUNTIME_TIMEOUT_MS || 20000);
    const afterLoadWaitMs = Number(process.env.HAZIFY_VISUAL_RUNTIME_AFTER_LOAD_MS || 250);
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    try {
      const profiles = [];
      for (const viewport of VIEWPORT_PROFILES) {
        const profile = await collectViewportProfile({
          browser,
          payload,
          viewport,
          timeoutMs,
          afterLoadWaitMs,
        });
        profiles.push(profile);
      }

      const merged = mergeRuntimeProfiles(profiles);
      return {
        success: true,
        ...merged,
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    return buildRuntimeError(error);
  }
}
