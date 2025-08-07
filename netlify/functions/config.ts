import { Handler } from "@netlify/functions";
import { getDescopeConfig, setDescopeConfig, DescopeConfig } from "./config-store.js";

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
      body: JSON.stringify(updatedConfig),
    };
  } catch (error) {
    console.error("Error updating configuration:", error);
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
