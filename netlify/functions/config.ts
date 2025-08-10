import { Handler } from "@netlify/functions";
import {
  getDescopeConfig,
  setDescopeConfig,
  DescopeConfig,
} from "./config-store.js";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Handle preflight requests
const handleOptions = () => ({
  statusCode: 200,
  headers: corsHeaders,
  body: "",
});

// GET /config - Get current configuration
const handleGet = async () => {
  try {
    const config = await getDescopeConfig();
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    };
  } catch (error) {
    console.error("Error getting configuration:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to get configuration" }),
    };
  }
};

// PUT /config - Update configuration
const handlePut = async (body: string) => {
  try {
    const config: DescopeConfig = JSON.parse(body);

    // Validate the configuration
    if (config.baseUrl && typeof config.baseUrl !== "string") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "baseUrl must be a string" }),
      };
    }

    if (config.projectId && typeof config.projectId !== "string") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "projectId must be a string" }),
      };
    }

    await setDescopeConfig(config);
    const updatedConfig = await getDescopeConfig();

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...updatedConfig,
        _warning: "Configuration saved but Netlify Blobs may not be available. Settings may not persist between deployments."
      }),
    };
  } catch (error) {
    console.error("Error updating configuration:", error);
    
    // Check if this is a Netlify Blobs configuration issue
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("MissingBlobsEnvironmentError")) {
      return {
        statusCode: 202, // Accepted but with limitations
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: "Netlify Blobs not configured. Configuration cannot be persisted.", 
          fallback: "Using environment variables as fallback.",
          config: await getDescopeConfig() // Return current config from env vars
        }),
      };
    }
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to update configuration" }),
    };
  }
};

// Main handler
export const handler: Handler = async (event) => {
  const method = event.httpMethod;

  switch (method) {
    case "OPTIONS":
      return handleOptions();
    case "GET":
      return handleGet();
    case "PUT":
      if (!event.body) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Request body is required" }),
        };
      }
      return handlePut(event.body);
    default:
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
  }
};
