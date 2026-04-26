let themeCheckModulePromise = null;

export async function loadThemeCheck() {
  if (!themeCheckModulePromise) {
    themeCheckModulePromise = import("@shopify/theme-check-node");
  }
  const module = await themeCheckModulePromise;
  return module.check;
}
