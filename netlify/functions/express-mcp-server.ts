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
    authPageUrl: "https://bs.com",
  },
});

// Auth middleware for session validation
app.use(["/mcp"], descopeMcpBearerAuth(provider));

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
    const baseUrl = process.env.DESCOPE_BASE_URL || "https://api.descope.com";
    const projectId = process.env.DESCOPE_PROJECT_ID;

    const wellKnownUrl = `${baseUrl}/v1/apps/${projectId}/.well-known/openid-configuration`;
    //fetch the well-known configuration
    fetch(wellKnownUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to fetch well-known configuration");
        }
        return response.json();
      })
      .then((data) => {
        // Process the well-known configuration data
        console.log("Well-known configuration:", data);
        // replace the registration_endpoint with the current server url
        data.registration_endpoint = `${req.protocol}://${req.get(
          "host"
        )}/register`;
        res.json(data);
      })
      .catch((error) => {
        console.error("Error fetching well-known configuration:", error);
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      });
  }
);

// OPTIONS handler for OAuth Authorization Server Metadata
app.options(
  "/.well-known/oauth-authorization-server",
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

// Export the serverless handler
export const handler = serverless(app);
