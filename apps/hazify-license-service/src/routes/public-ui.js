import fs from "fs/promises";
import path from "path";

export function createPublicUiHandlers({
  appRoot,
  onboardingLogoPath,
  json,
  redirectTo,
  renderOnboardingLandingPage,
  renderLoginPage,
  renderSignupPage,
  renderDashboardPage,
  resolveAccountSession,
  redeemAccountLicenseFromQuery,
  safeRedirectPath,
}) {
  function writeHtml(res, html) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
  }

  function handleLandingPage(_req, res) {
    return redirectTo(res, "/onboarding", 302);
  }

  async function handleOnboardingPage(req, res, url) {
    const resolved = resolveAccountSession(req);
    if (resolved.account) {
      const licenseKey = url.searchParams.get("licenseKey") || "";
      if (licenseKey) {
        try {
          await redeemAccountLicenseFromQuery(resolved.account, licenseKey);
        } catch (error) {
          console.warn("Failed to redeem license from onboarding query:", error);
        }
      }
      return redirectTo(res, "/dashboard");
    }
    return writeHtml(
      res,
      renderOnboardingLandingPage({
        next: safeRedirectPath(url.searchParams.get("next") || "/dashboard", "/dashboard"),
        licenseKey: url.searchParams.get("licenseKey") || "",
        payment: url.searchParams.get("payment") || "",
      })
    );
  }

  async function handleLoginPage(req, res, url) {
    const resolved = resolveAccountSession(req);
    if (resolved.account) {
      const licenseKey = url.searchParams.get("licenseKey") || "";
      if (licenseKey) {
        try {
          await redeemAccountLicenseFromQuery(resolved.account, licenseKey);
        } catch (error) {
          console.warn("Failed to redeem license from login query:", error);
        }
      }
      const next = safeRedirectPath(url.searchParams.get("next") || "/dashboard", "/dashboard");
      return redirectTo(res, next);
    }
    return writeHtml(
      res,
      renderLoginPage({
        next: safeRedirectPath(url.searchParams.get("next") || "/dashboard", "/dashboard"),
        licenseKey: url.searchParams.get("licenseKey") || "",
        error: url.searchParams.get("error") || "",
      })
    );
  }

  async function handleSignupPage(req, res, url) {
    const resolved = resolveAccountSession(req);
    if (resolved.account) {
      const licenseKey = url.searchParams.get("licenseKey") || "";
      if (licenseKey) {
        try {
          await redeemAccountLicenseFromQuery(resolved.account, licenseKey);
        } catch (error) {
          console.warn("Failed to redeem license from signup query:", error);
        }
      }
      const next = safeRedirectPath(url.searchParams.get("next") || "/dashboard", "/dashboard");
      return redirectTo(res, next);
    }
    return writeHtml(
      res,
      renderSignupPage({
        next: safeRedirectPath(url.searchParams.get("next") || "/dashboard", "/dashboard"),
        licenseKey: url.searchParams.get("licenseKey") || "",
        error: url.searchParams.get("error") || "",
      })
    );
  }

  async function handleDashboardPage(req, res, url) {
    const resolved = resolveAccountSession(req);
    if (!resolved.account) {
      const next = safeRedirectPath(url.pathname + (url.search || ""), "/dashboard");
      return redirectTo(res, `/onboarding?next=${encodeURIComponent(next)}`);
    }
    const licenseKey = url.searchParams.get("licenseKey") || "";
    if (licenseKey) {
      try {
        await redeemAccountLicenseFromQuery(resolved.account, licenseKey);
      } catch (error) {
        console.warn("Failed to redeem license from dashboard query:", error);
      }
    }
    return writeHtml(res, renderDashboardPage());
  }

  async function handleOnboardingLogo(_req, res) {
    try {
      const image = await fs.readFile(onboardingLogoPath);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": image.byteLength,
        "Cache-Control": "public, max-age=600",
      });
      res.end(image);
    } catch {
      json(res, 404, { error: "logo_not_found" });
    }
  }

  async function handleBrandAsset(_req, res, url) {
    const rel = decodeURIComponent(url.pathname.replace("/assets/brands/", ""));
    if (!/^[a-z0-9._-]+$/i.test(rel)) {
      return json(res, 400, { error: "invalid_asset_path" });
    }
    const assetPath = path.resolve(appRoot, "assets/brands", rel);
    const brandRoot = path.resolve(appRoot, "assets/brands");
    if (!assetPath.startsWith(brandRoot)) {
      return json(res, 400, { error: "invalid_asset_path" });
    }
    try {
      const content = await fs.readFile(assetPath);
      const ext = path.extname(assetPath).toLowerCase();
      const type =
        ext === ".svg"
          ? "image/svg+xml"
          : ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".ico"
          ? "image/x-icon"
          : "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": content.byteLength,
        "Cache-Control": "public, max-age=3600",
      });
      return res.end(content);
    } catch {
      return json(res, 404, { error: "asset_not_found" });
    }
  }

  return {
    handleLandingPage,
    handleOnboardingPage,
    handleLoginPage,
    handleSignupPage,
    handleDashboardPage,
    handleOnboardingLogo,
    handleBrandAsset,
  };
}
