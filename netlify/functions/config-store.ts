import { getStore } from "@netlify/blobs";

// Configuration interface
export interface DescopeConfig {
  projectId?: string;
  baseUrl?: string;
}

// Default configuration
const DEFAULT_CONFIG: DescopeConfig = {
  baseUrl: "https://api.descope.com",
  projectId: undefined,
};

// Get the blob store for configuration
function getConfigStore() {
  try {
    // Use the store name directly - Netlify should handle the environment automatically
    return getStore("descope-config");
  } catch (error) {
    console.error("Failed to create blob store:", error);
    throw new Error("Unable to initialize Netlify Blobs storage. This feature requires deployment to Netlify.");
  }
}

// Get configuration from blob storage
export async function getDescopeConfig(): Promise<DescopeConfig> {
  try {
    const store = getConfigStore();
    const config = await store.get("config", { type: "json" });

    if (!config) {
      return DEFAULT_CONFIG;
    }

    return {
      ...DEFAULT_CONFIG,
      ...config,
    };
  } catch (error) {
    console.warn(
      "Failed to load configuration from blobs, using defaults:",
      error
    );
    // If blobs are not available, return defaults (environment variables will be used as fallback)
    return DEFAULT_CONFIG;
  }
}

// Set configuration in blob storage
export async function setDescopeConfig(config: DescopeConfig): Promise<void> {
  try {
    const store = getConfigStore();
    const currentConfig = await getDescopeConfig();
    const newConfig = {
      ...currentConfig,
      ...config,
    };

    await store.set("config", JSON.stringify(newConfig));
  } catch (error) {
    console.error("Failed to save configuration to blobs:", error);
    // Don't throw error - this allows the app to continue working with env vars
    console.warn("Configuration will not be persisted. Using environment variables as fallback.");
  }
}

// Get project ID (with fallback to environment variable for backward compatibility)
export async function getProjectId(): Promise<string | undefined> {
  const config = await getDescopeConfig();
  return config.projectId || process.env.DESCOPE_PROJECT_ID;
}

// Get base URL (with fallback to environment variable for backward compatibility)
export async function getBaseUrl(): Promise<string> {
  const config = await getDescopeConfig();
  return (
    config.baseUrl || process.env.DESCOPE_BASE_URL || DEFAULT_CONFIG.baseUrl!
  );
}
