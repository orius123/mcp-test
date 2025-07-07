import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import createSdk from "@descope/node-sdk";

const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";

// Helper function for making NWS API requests
async function makeNWSRequest<T>(url: string): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/geo+json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making NWS request:", error);
    return null;
  }
}

interface AlertFeature {
  properties: {
    event?: string;
    areaDesc?: string;
    severity?: string;
    status?: string;
    headline?: string;
  };
}

// Format alert data
function formatAlert(feature: AlertFeature): string {
  const props = feature.properties;
  return [
    `Event: ${props.event || "Unknown"}`,
    `Area: ${props.areaDesc || "Unknown"}`,
    `Severity: ${props.severity || "Unknown"}`,
    `Status: ${props.status || "Unknown"}`,
    `Headline: ${props.headline || "No headline"}`,
    "---",
  ].join("\n");
}

interface ForecastPeriod {
  name?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
}

interface AlertsResponse {
  features: AlertFeature[];
}

interface PointsResponse {
  properties: {
    forecast?: string;
  };
}

interface ForecastResponse {
  properties: {
    periods: ForecastPeriod[];
  };
}

// Helper function to decode JWT unsafely and extract the sub claim
function getSubFromJwt(jwt: string): string {
  try {
    // Split the JWT into its three parts
    const parts = jwt.split(".");

    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }

    // Decode the payload (second part)
    const payload = parts[1];

    // Add padding if needed for base64 decoding
    const paddedPayload = payload + "=".repeat((4 - (payload.length % 4)) % 4);

    // Decode base64 and parse JSON
    const decodedPayload = JSON.parse(
      Buffer.from(paddedPayload, "base64").toString("utf-8")
    );

    if (!decodedPayload.sub) {
      throw new Error("No sub claim found in JWT");
    }

    return decodedPayload.sub;
  } catch (error) {
    console.error("Error decoding JWT:", error);
    throw new McpError(
      ErrorCode.InvalidRequest,
      "Invalid JWT format or missing sub claim"
    );
  }
}

// Helper function to decode client ID and extract project and app IDs
function decodeClientId(clientId: string): {
  projectId: string;
  appId: string;
} {
  try {
    // Decode base64
    const decoded = Buffer.from(clientId, "base64").toString("utf-8");

    // Split by colon
    const [projectId, appId] = decoded.split(":");

    if (!projectId || !appId) {
      throw new Error("Invalid client ID format");
    }

    return { projectId, appId };
  } catch (error) {
    console.error("Error decoding client ID:", error);
    throw new McpError(ErrorCode.InvalidRequest, "Invalid client ID format");
  }
}
export const createServer = () => {
  // Create server instance
  const server = new McpServer({
    name: "weather",
    version: "1.0.0",
  });

  // Register weather tools
  server.tool(
    "get-alerts",
    "Get weather alerts for a state",
    {
      state: z
        .string()
        .length(2)
        .describe("Two-letter state code (e.g. CA, NY)"),
    },
    async ({ state }, { authInfo }) => {
      console.log(
        "Received get-alerts request with state:",
        state,
        "authInfo:",
        authInfo
      );
      if (!authInfo?.scopes.includes("app:read")) {
        console.log("You are not authorized");
        throw new McpError(
          ErrorCode.InvalidRequest,
          "Insufficient permissions: 'app:read' scope required"
        );
      }

      console.log("Going to fetch outbound token");
      const descope = createSdk({
        projectId: process.env.DESCOPE_PROJECT_ID!,
        baseUrl: process.env.DESCOPE_BASE_URL,
      });
      const { appId } = decodeClientId(authInfo.clientId);
      const userId = getSubFromJwt(authInfo.token);
      console.log("Going to fetch token with: ", { appId, userId });
      const res = await descope.management.outboundApplication.fetchToken(
        "github",
        userId
      );
      console.log("Fetched outbound token successfully, res:", res);
      if (!res.ok) {
        throw new McpError(
          ErrorCode.InternalError,
          "Failed to fetch outbound token",
          res
        );
      }
      const stateCode = state.toUpperCase();
      const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
      const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl);

      if (!alertsData) {
        return {
          content: [
            {
              type: "text",
              text: "Failed to retrieve alerts data",
            },
          ],
        };
      }

      const features = alertsData.features || [];
      if (features.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No active alerts for ${stateCode}`,
            },
          ],
        };
      }

      const formattedAlerts = features.map(formatAlert);
      const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join(
        "\n"
      )}`;

      return {
        content: [
          {
            type: "text",
            text: alertsText,
          },
        ],
      };
    }
  );

  server.tool(
    "get-forecast",
    "Get weather forecast for a location",
    {
      latitude: z
        .number()
        .min(-90)
        .max(90)
        .describe("Latitude of the location"),
      longitude: z
        .number()
        .min(-180)
        .max(180)
        .describe("Longitude of the location"),
    },
    async ({ latitude, longitude }) => {
      // Get grid point data
      const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(
        4
      )},${longitude.toFixed(4)}`;
      const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);

      if (!pointsData) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
            },
          ],
        };
      }

      const forecastUrl = pointsData.properties?.forecast;
      if (!forecastUrl) {
        return {
          content: [
            {
              type: "text",
              text: "Failed to get forecast URL from grid point data",
            },
          ],
        };
      }

      // Get forecast data
      const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
      if (!forecastData) {
        return {
          content: [
            {
              type: "text",
              text: "Failed to retrieve forecast data",
            },
          ],
        };
      }

      const periods = forecastData.properties?.periods || [];
      if (periods.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No forecast periods available",
            },
          ],
        };
      }

      // Format forecast periods
      const formattedForecast = periods.map((period: ForecastPeriod) =>
        [
          `${period.name || "Unknown"}:`,
          `Temperature: ${period.temperature || "Unknown"}°${
            period.temperatureUnit || "F"
          }`,
          `Wind: ${period.windSpeed || "Unknown"} ${
            period.windDirection || ""
          }`,
          `${period.shortForecast || "No forecast available"}`,
          "---",
        ].join("\n")
      );

      const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join(
        "\n"
      )}`;

      return {
        content: [
          {
            type: "text",
            text: forecastText,
          },
        ],
      };
    }
  );

  return { server };
};
