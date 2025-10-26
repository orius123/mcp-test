import * as dotenv from "dotenv";
import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import serverless from "serverless-http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { descopeMcpAuthRouter, DescopeMcpProvider } from "@descope/mcp-express";
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

// Request logging middleware
app.use((req: Request, res: Response, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.url;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const ip = req.ip || req.connection.remoteAddress || 'Unknown';
  const contentType = req.get('Content-Type') || 'None';
  
  console.log(`[${timestamp}] ${method} ${url}`);
  console.log(`  IP: ${ip}`);
  console.log(`  User-Agent: ${userAgent}`);
  console.log(`  Content-Type: ${contentType}`);
  
  if (req.get('Authorization')) {
    console.log(`  Authorization: Bearer [REDACTED]`);
  }
  
  if (Object.keys(req.query).length > 0) {
    console.log(`  Query: ${JSON.stringify(req.query)}`);
  }
  
  // Log response when finished
  const originalSend = res.send;
  res.send = function(body) {
    console.log(`[${timestamp}] Response ${res.statusCode} for ${method} ${url}`);
    return originalSend.call(this, body);
  };
  
  next();
});

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

const provider = new DescopeMcpProvider({
  authorizationServerOptions: {
    isDisabled: false,
    enableDynamicClientRegistration: true,
  },
  dynamicClientRegistrationOptions: {
    nonConfidentialClient: true,
  },
});

// Auth middleware for session validation
app.use(descopeMcpAuthRouter(undefined, provider));

// Initialize transport
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // set to undefined for stateless servers
});

const { server } = createServer();

// Shared OAuth metadata handler
const handleOAuthMetadata = (req: Request, res: Response, pathSuffix: string = "") => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] OAuth Protected Resource metadata ${req.method} request${pathSuffix} from ${req.ip}`);
  
  const descopeBaseUrl = process.env.DESCOPE_BASE_URL || "https://api.descope.com";
  const projectId = process.env.DESCOPE_PROJECT_ID;
  const baseUrl = process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`;

  const metadata = {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [descopeBaseUrl + `/v1/apps/${projectId}`],
  };

  console.log(`[${timestamp}] Returning OAuth metadata${pathSuffix}:`, metadata);

  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, MCP-Protocol-Version",
  });

  if (req.method === "OPTIONS") {
    res.status(200).send("OK");
  } else {
    res.json(metadata);
  }
};

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
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] MCP Request received:`, {
    method: req.method,
    headers: {
      'content-type': req.get('Content-Type'),
      'authorization': req.get('Authorization') ? 'Bearer [REDACTED]' : 'None',
      'user-agent': req.get('User-Agent'),
    },
  });
  
  try {
    await connectServer();
    console.log(`[${timestamp}] Server connected, handling MCP request`);
    await transport.handleRequest(req, res, req.body);
    console.log(`[${timestamp}] MCP request handled successfully`);
  } catch (error) {
    console.error(`[${timestamp}] Error handling MCP request:`, error);
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
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Method not allowed - ${req.method} request to /mcp from ${req.ip}`);
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
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Health check request from ${req.ip}`);
  res.json({ status: "MCP Server is running" });
});

// OAuth Protected Resource Metadata endpoints
app.get("/.well-known/oauth-protected-resource", (req, res) => handleOAuthMetadata(req, res));
app.options("/.well-known/oauth-protected-resource", (req, res) => handleOAuthMetadata(req, res));

// OAuth Protected Resource Metadata endpoints with /mcp suffix
app.get("/.well-known/oauth-protected-resource/mcp", (req, res) => handleOAuthMetadata(req, res, " at /mcp path"));
app.options("/.well-known/oauth-protected-resource/mcp", (req, res) => handleOAuthMetadata(req, res, " at /mcp path"));


// Export the serverless handler
export const handler = serverless(app);
