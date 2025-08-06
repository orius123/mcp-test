import { getStore } from "@netlify/blobs";

// Constants
export const DEFAULT_DESCOPE_BASE_URL = 'https://api.descope.com';
export const DEFAULT_PROJECT_ID = '';

// Configuration interface
export interface DescopeConfig {
  projectId: string;
  baseUrl: string;
}

// Netlify Blobs configuration
const STORE_NAME = 'descope-config';
const CONFIG_KEY = 'settings';

// Load configuration from Netlify Blobs ONLY
export async function loadConfig(): Promise<DescopeConfig> {
  try {
    const store = getStore(STORE_NAME);
    const configData = await store.get(CONFIG_KEY, { type: 'text' });
    
    if (configData) {
      const config = JSON.parse(configData);
      console.log('✅ Loaded config from Netlify Blobs:', config);
      return {
        projectId: config.projectId || process.env.DESCOPE_PROJECT_ID || DEFAULT_PROJECT_ID,
        baseUrl: config.baseUrl || process.env.DESCOPE_BASE_URL || DEFAULT_DESCOPE_BASE_URL
      };
    }
    
    console.log('⚠️  No config found in Netlify Blobs, using environment variables');
    return {
      projectId: process.env.DESCOPE_PROJECT_ID || DEFAULT_PROJECT_ID,
      baseUrl: process.env.DESCOPE_BASE_URL || DEFAULT_DESCOPE_BASE_URL
    };
  } catch (error) {
    console.error('❌ Failed to load config from Netlify Blobs:', error);
    console.log('🔄 Falling back to environment variables');
    return {
      projectId: process.env.DESCOPE_PROJECT_ID || DEFAULT_PROJECT_ID,
      baseUrl: process.env.DESCOPE_BASE_URL || DEFAULT_DESCOPE_BASE_URL
    };
  }
}

// Save configuration to Netlify Blobs ONLY
export async function saveConfig(config: DescopeConfig): Promise<void> {
  try {
    const store = getStore(STORE_NAME);
    await store.set(CONFIG_KEY, JSON.stringify(config), {
      metadata: {
        updatedAt: new Date().toISOString(),
        version: '1.0'
      }
    });
    console.log('✅ Saved config to Netlify Blobs:', config);
  } catch (error) {
    console.error('❌ Failed to save config to Netlify Blobs:', error);
    throw new Error(`Netlify Blobs save failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Test Netlify Blobs functionality
export async function testBlobs(): Promise<{ success: boolean; details: string; error?: string }> {
  try {
    const store = getStore(STORE_NAME);
    const testKey = 'test-' + Date.now();
    const testData = { test: true, timestamp: new Date().toISOString() };
    
    // Test write
    await store.set(testKey, JSON.stringify(testData));
    
    // Test read
    const retrieved = await store.get(testKey, { type: 'text' });
    const parsedData = JSON.parse(retrieved || '{}');
    
    // Test delete
    await store.delete(testKey);
    
    if (parsedData.test === true) {
      return {
        success: true,
        details: `Netlify Blobs working correctly. Store: ${STORE_NAME}, Test key: ${testKey}`
      };
    } else {
      return {
        success: false,
        details: 'Data corruption during read/write test',
        error: `Expected test data, got: ${JSON.stringify(parsedData)}`
      };
    }
  } catch (error) {
    return {
      success: false,
      details: 'Netlify Blobs test failed',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}