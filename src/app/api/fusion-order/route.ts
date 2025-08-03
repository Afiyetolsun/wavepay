import {
  HashLock,
  NetworkEnum,
  OrderParams,
  PreparedOrder,
  PresetEnum,
  Quote,
  QuoteParams,
  RelayerRequest,
  SDK,
  SupportedChain,
} from "@1inch/cross-chain-sdk";

import crypto from "crypto";
import { solidityPackedKeccak256 } from "ethers";
import { NextResponse } from "next/server";
import { Client } from "pg";
import { v4 as uuidv4 } from "uuid";

const DEV_PORTAL_KEY = process.env.DEV_PORTAL_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DEV_PORTAL_KEY || !DATABASE_URL) {
  throw new Error(
    "Missing required environment variables: DEV_PORTAL_KEY or DATABASE_URL"
  );
}

const sdk = new SDK({
  url: "https://api.1inch.dev/fusion-plus",
  authKey: DEV_PORTAL_KEY,
});

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "An unknown error occurred";
}

// Helper to get a new DB client and connect
async function getDbClient() {
  const client = new Client({
    connectionString: DATABASE_URL,
  });
  await client.connect();
  return client;
}

function replacer(key: string, value: any) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function getQuoteWithRetry(
  params: QuoteParams,
  retries = 3
): Promise<Quote> {
  try {
    return await sdk.getQuote(params);
  } catch (err: any) {
    if (err?.response?.status === 429 && retries > 0) {
      const delay = (4 - retries) * 1000;
      console.warn(`Rate limited. Retrying in ${delay}ms...`);
      await new Promise((res) => setTimeout(res, delay));
      return getQuoteWithRetry(params, retries - 1);
    }
    throw err;
  }
}

// async function getOrderStatusWithRetry(
//   orderHash: string,
//   retries = 3
// ): Promise<any> {
//   try {
//     return await sdk.getOrderStatus(orderHash);
//   } catch (err: any) {
//     if (err?.response?.status === 429 && retries > 0) {
//       const delay = (4 - retries) * 1000;
//       console.warn(
//         `Rate limited getting order status. Retrying in ${delay}ms...`
//       );
//       await new Promise((res) => setTimeout(res, delay));
//       return getOrderStatusWithRetry(orderHash, retries - 1);
//     }
//     throw err;
//   }
// }

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const orderHash = searchParams.get("orderHash");

    if (action === "quote") {
      const srcChainIdStr = searchParams.get("srcChainId") || NetworkEnum.ARBITRUM.toString();
      const dstChainIdStr = searchParams.get("dstChainId") || NetworkEnum.COINBASE.toString();
      const srcTokenAddress = searchParams.get("srcTokenAddress");
      const dstTokenAddress = searchParams.get("dstTokenAddress");
      const amount = searchParams.get("amount");
      const walletAddress = searchParams.get("walletAddress");

      if (!walletAddress || !srcTokenAddress || !dstTokenAddress || !amount) {
        return NextResponse.json(
          { error: "Missing required parameters" },
          { status: 400 }
        );
      }

      try {
        const quoterRequestParams: QuoteParams = {
          srcChainId: parseInt(srcChainIdStr),
          dstChainId: parseInt(dstChainIdStr),
          srcTokenAddress,
          dstTokenAddress,
          amount,
          enableEstimate: true,
          walletAddress,
        };
        const quoteInstance: Quote = await getQuoteWithRetry(quoterRequestParams);
        const jsonSafeBody = JSON.parse(
          JSON.stringify({ quoterRequestParams, quote: quoteInstance }, replacer)
        );
        return NextResponse.json(jsonSafeBody);
      } catch (error: unknown) {
        console.error("Error getting quote:", error);
        // Return 400 for known bad requests, otherwise 500
        // const status = (error as any)?.response?.status === 400 ? 400 : 500;
        return NextResponse.json({ error: formatError(error) }, { status: 400 });
      }
    } else if (action === "status" && orderHash) {
      const client = new Client(DATABASE_URL);
      try {
        await client.connect();
        // const orderStatus = await getOrderStatusWithRetry(orderHash);
        const { rows } = await client.query(
          "SELECT status, attempts FROM fusion_orders WHERE order_hash = $1",
          [orderHash]
        );
        const status = rows[0] ? rows[0].status : "not_found";
        return NextResponse.json({ status });
      } catch (error: unknown) {
        console.error("Error getting order status:", error);
        return NextResponse.json({ error: formatError(error) }, { status: 500 });
      } finally {
        await client.end();
      }
    }

    return NextResponse.json(
      { message: "Invalid action or missing parameters" },
      { status: 400 }
    );
  } catch (error: unknown) {
    console.error("Unhandled error in GET handler:", error);
    return NextResponse.json({ error: formatError(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "prepare-order") {
      const { quoterRequestParams, walletAddress } = body as {
        quoterRequestParams: QuoteParams;
        walletAddress: string;
      };

      if (!quoterRequestParams || !walletAddress) {
        return NextResponse.json(
          { error: "Missing quoterRequestParams or walletAddress" },
          { status: 400 }
        );
      }

      try {
        const liveQuote = await getQuoteWithRetry(quoterRequestParams);
        const preset: PresetEnum = liveQuote.recommendedPreset;
        if (!preset)
          throw new Error("Could not determine a preset from the quote.");

        const presetData = liveQuote.presets[preset];
        if (!presetData)
          throw new Error(`Preset data not found for preset: ${preset}`);

        const secretsCount = presetData.secretsCount;
        const secrets = Array.from({ length: secretsCount }).map(
          () => "0x" + Buffer.from(crypto.randomBytes(32)).toString("hex")
        );
        const secretHashes = secrets.map((s) => HashLock.hashSecret(s));

        const hashLockInstance =
          secretsCount === 1
            ? HashLock.forSingleFill(secrets[0])
            : HashLock.forMultipleFills(
                secretHashes.map(
                  (secretHash, i) =>
                    solidityPackedKeccak256(
                      ["uint64", "bytes32"],
                      [BigInt(i), secretHash]
                    ) as any
                )
              );

        const crossChainOrderParams: OrderParams = {
          walletAddress,
          receiver: walletAddress,
          preset: liveQuote.recommendedPreset,
          hashLock: hashLockInstance,
          secretHashes,
        };

        const fusionOrder: PreparedOrder = await sdk.createOrder(
          liveQuote,
          crossChainOrderParams
        );
        const typedData = fusionOrder.order.getTypedData(
          quoterRequestParams.srcChainId
        );
        if (
          !typedData ||
          !typedData.domain ||
          !typedData.types ||
          !typedData.message
        ) {
          throw new Error(
            "Failed to construct EIP-712 typed data from the order created by SDK."
          );
        }

        const typedDataPayload = {
          domain: typedData.domain,
          types: typedData.types,
          message: typedData.message,
          primaryType: typedData.primaryType || "Order",
        };

        const preparationId = uuidv4();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
        const orderStruct = fusionOrder.order.build(); // Build order struct once
        const extensionData = fusionOrder.order.extension.encode(); // Encode extension once
        const orderHash = fusionOrder.order.getOrderHash(
          quoterRequestParams.srcChainId
        ); // Get order hash here

        const client = await getDbClient();
        try {
          await client.query(
            `INSERT INTO fusion_order_preparations (
              preparation_id, live_quote_json, secrets_json, order_params_json, order_struct_json, quote_id, expires_at, extension_data, order_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              preparationId,
              JSON.stringify(liveQuote, replacer),
              JSON.stringify(secrets),
              JSON.stringify(crossChainOrderParams),
              JSON.stringify(orderStruct),
              fusionOrder.quoteId,
              expiresAt,
              extensionData,
              orderHash, // Store order hash
            ]
          );
        } finally {
          await client.end();
        }

        return NextResponse.json({ preparationId, typedDataPayload });
      } catch (error: unknown) {
        console.error("Error preparing order:", error);
        const status = (error as any)?.response?.status === 400 ? 400 : 500;
        return NextResponse.json({ error: formatError(error) }, { status });
      }
    }
    const { preparationId, signature } = body as {
      preparationId: string;
      signature: string;
    };

    if (!preparationId || !signature) {
      return NextResponse.json(
        { error: "Missing preparationId or signature" },
        { status: 400 }
      );
    }

    const client = await getDbClient();
    let prepData:
      | {
          liveQuote: Quote;
          secrets: string[];
          orderParams: OrderParams;
          orderStruct: any;
          quoteId: string;
          extensionData: string;
          orderHash: string;
        }
      | undefined;

    try {
      const { rows } = await client.query(
        "SELECT live_quote_json, secrets_json, order_params_json, order_struct_json, quote_id, expires_at, extension_data, order_hash FROM fusion_order_preparations WHERE preparation_id = $1",
        [preparationId]
      );

      if (rows.length === 0) {
        return NextResponse.json(
          { error: "Order preparation data not found" },
          { status: 404 }
        );
      }

      const row = rows[0];
      if (new Date(row.expires_at) < new Date()) {
        // Data expired, delete it
        await client.query(
          "DELETE FROM fusion_order_preparations WHERE preparation_id = $1",
          [preparationId]
        );
        return NextResponse.json(
          { error: "Order preparation data expired" },
          { status: 404 }
        );
      }

      prepData = {
        liveQuote: row.live_quote_json,
        secrets: row.secrets_json,
        orderParams: row.order_params_json,
        orderStruct: row.order_struct_json,
        quoteId: row.quote_id,
        extensionData: row.extension_data,
        orderHash: row.order_hash,
      };

      // Delete the preparation data after successful retrieval to prevent reuse
      await client.query(
        "DELETE FROM fusion_order_preparations WHERE preparation_id = $1",
        [preparationId]
      );

      const relayerRequestParams = {
        srcChainId: NetworkEnum.ARBITRUM as SupportedChain,
        order: prepData.orderStruct,
        signature,
        quoteId: prepData.quoteId,
        extension: prepData.extensionData,
        secretHashes:
          prepData.orderParams.secretHashes.length === 1
            ? undefined
            : prepData.orderParams.secretHashes,
      };

      const relayerRequest = new RelayerRequest(relayerRequestParams);
      await sdk.api.submitOrder(relayerRequest);

      const orderHash = prepData.orderHash; // Use stored order hash

      await client.query(
        `INSERT INTO fusion_orders (order_hash, secrets, status, attempts)
         VALUES ($1, $2, 'pending', 0)
         ON CONFLICT (order_hash) DO NOTHING`,
        [orderHash, JSON.stringify(prepData.secrets)]
      );

      return NextResponse.json({ orderHash, status: "pending" });
    } catch (error: unknown) {
      console.error("Error placing signed order:", error);
      const status = (error as any)?.response?.status === 400 ? 400 : 500;
      return NextResponse.json({ error: formatError(error) }, { status });
    } finally {
      await client.end();
    }

  } catch (error: unknown) {
    console.error("Unhandled error in POST handler:", error);
    return NextResponse.json({ error: formatError(error) }, { status: 400 });
  }
}
