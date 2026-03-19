import { z } from "zod";

const GetLicenseStatusInputSchema = z.object({});

const createGetLicenseStatusTool = (execute) => ({
  name: "get-license-status",
  description: "Return current license status, effective access, and MCP scope capabilities.",
  schema: GetLicenseStatusInputSchema,
  execute,
});

export { GetLicenseStatusInputSchema, createGetLicenseStatusTool };
