import * as dotenv from "dotenv";
import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import serverless from "serverless-http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { descopeMcpBearerAuth, DescopeMcpProvider } from "@descope/mcp-express";
import { createServer } from "./create-server.js";

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

// In-memory storage for UI configuration (in production, you might want to use a database)
let uiConfig = {
  projectId: '',
  baseUrl: 'https://api.descope.com'
};

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

// const provider = new DescopeMcpProvider({
//   verifyTokenOptions: {
//     requiredScopes: ["app:read", "app:manage"],
//   },
// });

// Auth middleware for session validation
app.use(["/mcp"], descopeMcpBearerAuth());

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
app.post("/api/config", (req: Request, res: Response) => {
  try {
    const { projectId, baseUrl } = req.body;
    
    // Validate input
    if (typeof projectId !== 'string' || typeof baseUrl !== 'string') {
      return res.status(400).json({ error: "Invalid configuration data" });
    }
    
    // Update in-memory configuration
    uiConfig.projectId = projectId.trim();
    uiConfig.baseUrl = baseUrl.trim() || 'https://api.descope.com';
    
    console.log('Configuration updated:', uiConfig);
    
    res.json({ 
      success: true, 
      config: uiConfig,
      message: "Configuration updated successfully" 
    });
  } catch (error) {
    console.error('Error updating configuration:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/config", (req: Request, res: Response) => {
  // Return current configuration (without sensitive data)
  res.json({
    projectId: uiConfig.projectId || process.env.DESCOPE_PROJECT_ID || '',
    baseUrl: uiConfig.baseUrl || process.env.DESCOPE_BASE_URL || 'https://api.descope.com'
  });
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
  (req: Request, res: Response) => {
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
  (req: Request, res: Response) => {
    // Use UI configuration with environment variable fallback
    const baseUrl = uiConfig.baseUrl || process.env.DESCOPE_BASE_URL || "https://api.descope.com";
    const projectId = uiConfig.projectId || process.env.DESCOPE_PROJECT_ID;

    if (!projectId) {
      return res.status(400).json({ 
        error: "Project ID not configured. Please set it via the UI configuration or DESCOPE_PROJECT_ID environment variable." 
      });
    }

    const redirectUrl = `${baseUrl}/v1/apps/${projectId}/.well-known/openid-configuration`;

    res.redirect(302, redirectUrl);
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
