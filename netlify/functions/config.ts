import { getStore } from "@netlify/blobs";

// Constants
export const DEFAULT_DESCOPE_BASE_URL = 'https://api.descope.com';
export const DEFAULT_PROJECT_ID = '';

// Configuration interface
export interface DescopeConfig {
  projectId: string;
  baseUrl: string;
}

// In-memory fallback storage
let inMemoryConfig: DescopeConfig | null = null;

// Check if Netlify Blobs is available
let blobsAvailable = true;
let configStore: any = null;

try {
  configStore = getStore('descope-config');
} catch (error) {
  console.warn('Netlify Blobs not available, falling back to in-memory storage:', error);
  blobsAvailable = false;
}

const CONFIG_KEY = 'settings';

// Load configuration with multiple fallbacks
export async function loadConfig(): Promise<DescopeConfig> {
  // Try Netlify Blobs first if available
  if (blobsAvailable && configStore) {
    try {
      const blobData = await configStore.get(CONFIG_KEY, { type: 'text' });
      if (blobData) {
        const blobConfig = JSON.parse(blobData);
        console.log('Loaded config from Netlify Blobs:', blobConfig);
        return {
          projectId: blobConfig.projectId || process.env.DESCOPE_PROJECT_ID || DEFAULT_PROJECT_ID,
          baseUrl: blobConfig.baseUrl || process.env.DESCOPE_BASE_URL || DEFAULT_DESCOPE_BASE_URL
        };
      }
    } catch (error) {
      console.warn('Failed to load config from Netlify Blobs:', error);
      blobsAvailable = false; // Disable blobs for future requests
    }
  }

  // Try in-memory storage
  if (inMemoryConfig) {
    console.log('Loaded config from in-memory storage:', inMemoryConfig);
    return {
      projectId: inMemoryConfig.projectId || process.env.DESCOPE_PROJECT_ID || DEFAULT_PROJECT_ID,
      baseUrl: inMemoryConfig.baseUrl || process.env.DESCOPE_BASE_URL || DEFAULT_DESCOPE_BASE_URL
    };
  }

  // Final fallback to environment variables
  console.log('Using environment variable config only');
  return {
    projectId: process.env.DESCOPE_PROJECT_ID || DEFAULT_PROJECT_ID,
    baseUrl: process.env.DESCOPE_BASE_URL || DEFAULT_DESCOPE_BASE_URL
  };
}

// Save configuration with fallback handling
export async function saveConfig(config: DescopeConfig): Promise<{ storage: string; success: boolean }> {
  // Try Netlify Blobs first if available
  if (blobsAvailable && configStore) {
    try {
      await configStore.set(CONFIG_KEY, JSON.stringify(config), { 
        metadata: { 
          updatedAt: new Date().toISOString() 
        }
      });
      console.log('Saved config to Netlify Blobs:', config);
      inMemoryConfig = config; // Also store in memory as backup
      return { storage: 'netlify-blobs', success: true };
    } catch (error) {
      console.warn('Failed to save config to Netlify Blobs, falling back to in-memory:', error);
      blobsAvailable = false; // Disable blobs for future requests
    }
  }

  // Fallback to in-memory storage
  inMemoryConfig = config;
  console.log('Saved config to in-memory storage:', config);
  return { storage: 'in-memory', success: true };
}