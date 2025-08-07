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
  return getStore("descope-config");
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
    console.warn("Failed to load configuration from blobs, using defaults:", error);
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
    throw error;
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
  return config.baseUrl || process.env.DESCOPE_BASE_URL || DEFAULT_CONFIG.baseUrl!;
}
