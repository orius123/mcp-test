import { getStore } from "@netlify/blobs";

// Constants
export const DEFAULT_DESCOPE_BASE_URL = 'https://api.descope.com';
export const DEFAULT_PROJECT_ID = '';

// Configuration interface
export interface DescopeConfig {
  projectId: string;
  baseUrl: string;
}

// Blob storage for configuration
const configStore = getStore('descope-config');
const CONFIG_KEY = 'settings';

// Load configuration from Netlify Blobs with fallbacks
export async function loadConfig(): Promise<DescopeConfig> {
  try {
    // Try to load from Netlify Blobs first
    const blobData = await configStore.get(CONFIG_KEY, { type: 'text' });
    if (blobData) {
      const blobConfig = JSON.parse(blobData);
      console.log('Loaded config from blobs:', blobConfig);
      return {
        projectId: blobConfig.projectId || process.env.DESCOPE_PROJECT_ID || DEFAULT_PROJECT_ID,
        baseUrl: blobConfig.baseUrl || process.env.DESCOPE_BASE_URL || DEFAULT_DESCOPE_BASE_URL
      };
    }
  } catch (error) {
    console.warn('Failed to load config from blobs:', error);
  }

  // Fallback to environment variables
  console.log('Using environment variable config');
  return {
    projectId: process.env.DESCOPE_PROJECT_ID || DEFAULT_PROJECT_ID,
    baseUrl: process.env.DESCOPE_BASE_URL || DEFAULT_DESCOPE_BASE_URL
  };
}

// Save configuration to Netlify Blobs
export async function saveConfig(config: DescopeConfig): Promise<void> {
  try {
    await configStore.set(CONFIG_KEY, JSON.stringify(config), { 
      metadata: { 
        updatedAt: new Date().toISOString() 
      }
    });
    console.log('Saved config to blobs:', config);
  } catch (error) {
    console.error('Failed to save config to blobs:', error);
    throw error;
  }
}