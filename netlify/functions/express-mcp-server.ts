import * as dotenv from "dotenv";
import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import serverless from "serverless-http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { descopeMcpBearerAuth, DescopeMcpProvider } from "@descope/mcp-express";
import { createServer } from "./create-server.js";
import { getStore } from "@netlify/blobs";

// Type declarations
declare global {
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

// Environment setup
dotenv.config();

// Initialize Express app
const app = express();

// Blob storage for configuration
const configStore = getStore('descope-config');
const CONFIG_KEY = 'settings';

// Configuration interface
interface DescopeConfig {
  projectId: string;
  baseUrl: string;
}

// Load configuration from Netlify Blobs with fallbacks
async function loadConfig(): Promise<DescopeConfig> {
  try {
    // Try to load from Netlify Blobs first
    const blobData = await configStore.get(CONFIG_KEY, { type: 'text' });
    if (blobData) {
      const blobConfig = JSON.parse(blobData);
      console.log('Loaded config from blobs:', blobConfig);
      return {
        projectId: blobConfig.projectId || process.env.DESCOPE_PROJECT_ID || '',
        baseUrl: blobConfig.baseUrl || process.env.DESCOPE_BASE_URL || 'https://api.descope.com'
      };
    }
  } catch (error) {
    console.warn('Failed to load config from blobs:', error);
  }

  // Fallback to environment variables
  console.log('Using environment variable config');
  return {
    projectId: process.env.DESCOPE_PROJECT_ID || '',
    baseUrl: process.env.DESCOPE_BASE_URL || 'https://api.descope.com'
  };
}

// Save configuration to Netlify Blobs
async function saveConfig(config: DescopeConfig): Promise<void> {
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

// Middleware setup
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));
app.use(
  cors({
    origin: true,
    methods: "*",
    allowedHeaders: "Authorization, Origin, Content-Type, Accept, *",
  })
);
app.options("*", cors());

// Create dynamic Descope MCP provider
async function createProvider(): Promise<DescopeMcpProvider> {
  const config = await loadConfig();
  
  const provider = new DescopeMcpProvider({
    projectId: config.projectId,
    baseUrl: config.baseUrl,
    // managementKey: process.env.DESCOPE_MANAGEMENT_KEY, // Still from env for security
    verifyTokenOptions: {
      requiredScopes: ["app:read", "app:manage"],
    },
  });
  
  return provider;
}

// Dynamic auth middleware for MCP routes
async function dynamicMcpAuth(req: Request, res: Response, next: any) {
  try {
    const provider = await createProvider();
    const middleware = descopeMcpBearerAuth(provider);
    middleware(req, res, next);
  } catch (error) {
    console.error('Error creating Descope provider:', error);
    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Authentication configuration error",
      },
      id: null,
    });
  }
}

// Auth middleware for session validation
app.use(["/mcp"], dynamicMcpAuth);

// Initialize transport
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // set to undefined for stateless servers
});

const { server } = createServer();

// Connect server to transport
let serverConnected = false;
const connectServer = async () => {
  if (!serverConnected) {
    try {
      await server.connect(transport);
      serverConnected = true;
      console.log("Server connected successfully");
    } catch (error) {
      console.error("Failed to connect server:", error);
      throw error;
    }
  }
};

// MCP endpoint
app.post("/mcp", async (req: Request, res: Response) => {
  console.log("Received MCP request:", req.body);
  try {
    await connectServer();
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

// Method not allowed handlers
const methodNotAllowed = (req: Request, res: Response) => {
  console.log(`Received ${req.method} MCP request`);
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
};

app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// Health check endpoint
app.get("/", (req: Request, res: Response) => {
  res.json({ status: "MCP Server is running" });
});

// Configuration API endpoints
app.post("/api/config", async (req: Request, res: Response) => {
  try {
    const { projectId, baseUrl } = req.body;
    
    // Validate input
    if (typeof projectId !== 'string' || typeof baseUrl !== 'string') {
      return res.status(400).json({ error: "Invalid configuration data" });
    }
    
    // Create configuration object
    const config: DescopeConfig = {
      projectId: projectId.trim(),
      baseUrl: baseUrl.trim() || 'https://api.descope.com'
    };
    
    // Save to Netlify Blobs
    await saveConfig(config);
    
    res.json({ 
      success: true, 
      config: config,
      message: "Configuration saved successfully",
      storage: "netlify-blobs"
    });
  } catch (error) {
    console.error('Error updating configuration:', error);
    res.status(500).json({ 
      error: "Failed to save configuration",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/config", async (_req: Request, res: Response) => {
  try {
    const config = await loadConfig();
    res.json({
      ...config,
      storage: "netlify-blobs",
      hasEnvFallback: {
        projectId: !!process.env.DESCOPE_PROJECT_ID,
        baseUrl: !!process.env.DESCOPE_BASE_URL
      }
    });
  } catch (error) {
    console.error('Error loading configuration:', error);
    res.status(500).json({ 
      error: "Failed to load configuration",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// OAuth Protected Resource Metadata endpoint
app.get(
  "/.well-known/oauth-protected-resource",
  (req: Request, res: Response) => {
    const baseUrl =
      process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`;

    const metadata = {
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
      resource_documentation: `${baseUrl}/docs`,
    };

    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, MCP-Protocol-Version",
    });

    res.json(metadata);
  }
);

// OPTIONS handler for OAuth Protected Resource Metadata
app.options(
  "/.well-known/oauth-protected-resource",
  (_req: Request, res: Response) => {
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, MCP-Protocol-Version",
    });
    res.status(200).send("OK");
  }
);

// OAuth Authorization Server Metadata endpoint
app.get(
  "/.well-known/oauth-authorization-server",
  async (_req: Request, res: Response) => {
    try {
      // Use blob configuration with environment variable fallback
      const config = await loadConfig();
      const { baseUrl, projectId } = config;

      if (!projectId) {
        return res.status(400).json({ 
          error: "Project ID not configured. Please set it via the UI configuration or DESCOPE_PROJECT_ID environment variable." 
        });
      }

      const redirectUrl = `${baseUrl}/v1/apps/${projectId}/.well-known/openid-configuration`;

      res.redirect(302, redirectUrl);
    } catch (error) {
      console.error('Error loading configuration for OAuth endpoint:', error);
      res.status(500).json({ 
        error: "Internal server error loading configuration" 
      });
    }
  }
);

// OPTIONS handler for OAuth Authorization Server Metadata
app.options(
  "/.well-known/oauth-authorization-server",
  (_req: Request, res: Response) => {
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, MCP-Protocol-Version",
    });
    res.status(200).send("OK");
  }
);

// Export the serverless handler
export const handler = serverless(app);
