import { SDK } from "@1inch/cross-chain-sdk";
import { NextResponse } from "next/server";
import { Client } from "pg";

const DEV_PORTAL_KEY = process.env.DEV_PORTAL_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const CRON_SECRET = process.env.CRON_SECRET;

if (!DEV_PORTAL_KEY || !DATABASE_URL || !CRON_SECRET) {
  throw new Error(
    "Missing required environment variables: DEV_PORTAL_KEY, DATABASE_URL, or CRON_SECRET"
  );
}

const sdk = new SDK({
  url: "https://api.1inch.dev/fusion-plus",
  authKey: DEV_PORTAL_KEY,
});

// Structured logging function
function logMessage(
  level: "info" | "warn" | "error",
  message: string,
  context: Record<string, any> = {}
) {
  console[level](
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    })
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "An unknown error occurred";
}

async function getOrderStatusWithRetry(
  orderHash: string,
  retries = 3
): Promise<any> {
  try {
    return await sdk.getOrderStatus(orderHash);
  } catch (err: any) {
    if (err?.response?.status === 429 && retries > 0) {
      const delay = (4 - retries) * 1000;
      logMessage(
        "warn",
        `Rate limited getting order status. Retrying in ${delay}ms`,
        { orderHash, retries }
      );
      await new Promise((res) => setTimeout(res, delay));
      return getOrderStatusWithRetry(orderHash, retries - 1);
    }
    throw err;
  }
}

async function getReadyToAcceptSecretFillsWithRetry(
  orderHash: string,
  retries = 3
): Promise<any> {
  try {
    return await sdk.getReadyToAcceptSecretFills(orderHash);
  } catch (err: any) {
    if (err?.response?.status === 429 && retries > 0) {
      const delay = (4 - retries) * 1000;
      logMessage(
        "warn",
        `Rate limited getting ready to accept fills. Retrying in ${delay}ms`,
        { orderHash, retries }
      );
      await new Promise((res) => setTimeout(res, delay));
      return getReadyToAcceptSecretFillsWithRetry(orderHash, retries - 1);
    }
    throw err;
  }
}

async function submitSecretWithRetry(
  orderHash: string,
  secret: string,
  retries = 3
): Promise<any> {
  try {
    return await sdk.submitSecret(orderHash, secret);
  } catch (err: any) {
    if (err?.response?.status === 429 && retries > 0) {
      const delay = (4 - retries) * 1000;
      logMessage(
        "warn",
        `Rate limited submitting secret. Retrying in ${delay}ms`,
        { orderHash, retries }
      );
      await new Promise((res) => setTimeout(res, delay));
      return submitSecretWithRetry(orderHash, secret, retries - 1);
    }
    throw err;
  }
}

async function cleanupExpiredPreparations(client: Client) {
  try {
    await client.query(
      "DELETE FROM fusion_order_preparations WHERE expires_at < NOW()"
    );
    logMessage("info", "Cleaned up expired order preparations.");
  } catch (error) {
    logMessage("error", "Error cleaning up expired order preparations:", {
      error: formatError(error),
    });
  }
}

async function cleanupOldOrders(client: Client) {
  try {
    await client.query(
      "DELETE FROM fusion_orders WHERE status IN ('executed', 'timeout') AND updated_at < NOW() - INTERVAL '7 days'"
    );
    logMessage("info", "Cleaned up old orders");
  } catch (error) {
    logMessage("error", "Error cleaning up old orders:", {
      error: formatError(error),
    });
  }
}

export async function POST(request: Request) {
  // Check Authorization header
  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    logMessage("error", "Unauthorized access attempt", { authHeader });
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const client = new Client({
    connectionString: DATABASE_URL,
  });

  try {
    await client.connect();

    // Run cleanup functions with a 10% chance
    if (Math.random() < 0.1) {
      await cleanupExpiredPreparations(client);
      await cleanupOldOrders(client);
    }

    // Fetch up to 100 pending orders to avoid timeout
    const { rows } = await client.query(
      "SELECT order_hash, secrets, attempts FROM fusion_orders WHERE status = 'pending' LIMIT 50"
    );

    if (rows.length === 0) {
      // logMessage("info", "No pending orders to process");
      return NextResponse.json({ message: "No pending orders to process" });
    }

    const maxAttempts = 10; // ~10 minutes with 1m intervals

    for (const order of rows) {
      const orderHash = order.order_hash;
      let secrets: string[];
      try {
        if (typeof order.secrets === "string") {
          secrets = JSON.parse(order.secrets);
        } else if (Array.isArray(order.secrets)) {
          secrets = order.secrets;
        } else {
          throw new Error(
            "Invalid secrets format: expected JSON string or array"
          );
        }

        if (
          !Array.isArray(secrets) ||
          !secrets.every((s) => typeof s === "string" && s.startsWith("0x"))
        ) {
          throw new Error(
            "Invalid secrets format: must be an array of hex strings"
          );
        }
      } catch (err: unknown) {
        const errorMessage = formatError(err);
        await client.query(
          "UPDATE fusion_orders SET status = 'error', error_message = $1, updated_at = NOW() WHERE order_hash = $2",
          [errorMessage, orderHash]
        );
        logMessage("error", `Invalid secrets JSON: ${errorMessage}`, {
          orderHash,
          secrets: order.secrets,
        });
        continue;
      }

      const attempts = order.attempts;

      if (attempts >= maxAttempts) {
        await client.query(
          "UPDATE fusion_orders SET status = 'timeout', updated_at = NOW() WHERE order_hash = $1",
          [orderHash]
        );
        logMessage("warn", `Order timed out after ${maxAttempts} attempts`, {
          orderHash,
        });
        continue;
      }

      try {
        const orderStatus = await getOrderStatusWithRetry(orderHash);
        if (orderStatus.status === "executed") {
          await client.query(
            "UPDATE fusion_orders SET status = 'executed', updated_at = NOW() WHERE order_hash = $1",
            [orderHash]
          );
          logMessage("info", `Order executed`, { orderHash });
          continue;
        }

        const fillsObject = await getReadyToAcceptSecretFillsWithRetry(
          orderHash
        );
        if (fillsObject?.fills?.length > 0) {
          for (const fill of fillsObject.fills as { idx: number }[]) {
            if (fill.idx >= 0 && fill.idx < secrets.length) {
              logMessage("info", `Submitting secret for fill ${fill.idx}`, {
                orderHash,
                fillIdx: fill.idx,
              });
              await submitSecretWithRetry(orderHash, secrets[fill.idx]);
            }
          }
        }

        await client.query(
          "UPDATE fusion_orders SET attempts = attempts + 1, updated_at = NOW() WHERE order_hash = $1",
          [orderHash]
        );
        logMessage("info", `Processed order attempt ${attempts + 1}`, {
          orderHash,
          attempts: attempts + 1,
        });
      } catch (err: unknown) {
        const errorMessage = formatError(err);
        await client.query(
          "UPDATE fusion_orders SET status = 'error', error_message = $1, updated_at = NOW() WHERE order_hash = $2",
          [errorMessage, orderHash]
        );
        logMessage("error", `Error processing order: ${errorMessage}`, {
          orderHash,
          error: errorMessage,
        });
      }
    }

    return NextResponse.json({ message: `Processed ${rows.length} orders` });
  } catch (error: unknown) {
    const errorMessage = formatError(error);
    logMessage("error", `Error in order processing: ${errorMessage}`, {
      error: errorMessage,
    });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  } finally {
    await client.end();
  }
}
