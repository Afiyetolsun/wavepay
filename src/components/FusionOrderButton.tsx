"use client";

import { Quote, QuoteParams } from "@1inch/cross-chain-sdk";
import { useState } from "react";
import { Address, TypedDataDefinition, TypedDataDomain } from "viem";
import { useAccount, useWalletClient } from "wagmi";

interface BackendQuoteResponse {
  quoterRequestParams: QuoteParams;
  quote: Quote;
}

interface PrepareOrderResponse {
  preparationId: string;
  typedDataPayload: {
    domain: TypedDataDomain;
    types: TypedDataDefinition["types"];
    message: Record<string, any>;
    primaryType: string;
  };
}

interface PlaceSignedOrderResponse {
  orderHash: string;
  status: string;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export const FusionOrderButton = () => {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [loading, setLoading] = useState(false);
  const [orderHash, setOrderHash] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreateOrder = async () => {
    if (!isConnected || !address || !walletClient || !walletClient.account) {
      setError(
        "Wallet client not ready or account not available. Please reconnect."
      );
      return;
    }

    setLoading(true);
    setError(null);
    setOrderHash(null);
    setStatus(null);

    try {
      // 1. Get Quote from backend API
      const srcTokenAddress = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // USDC on Arbitrum
      const dstTokenAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
      const amount = "100000"; // 0.1 USDC (6 decimals)
      const srcChainId = walletClient.getChainId() || 42161; // Default to Arbitrum
      setStatus("Fetching quote...");
      const quoteApiUrl = `/api/fusion-order?action=quote&walletAddress=${address}&srcTokenAddress=${srcTokenAddress}&dstTokenAddress=${dstTokenAddress}&amount=${amount}&srcChainId=${srcChainId}`;
      const quoteApiResponse = await fetch(quoteApiUrl);

      if (!quoteApiResponse.ok) {
        const errData = await quoteApiResponse.json();
        throw new Error(errData.error || "Failed to get quote from API");
      }
      const backendQuoteData: BackendQuoteResponse =
        await quoteApiResponse.json();

      // Wait a bit to fix 429
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 2. Prepare Order
      setStatus("Preparing order for signing...");
      const prepareOrderResponse = await fetch("/api/fusion-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare-order",
          quoterRequestParams: backendQuoteData.quoterRequestParams,
          walletAddress: address,
        }),
      });

      if (!prepareOrderResponse.ok) {
        const errData = await prepareOrderResponse.json();
        throw new Error(errData.error || "Failed to prepare order");
      }
      const preparedOrder: PrepareOrderResponse =
        await prepareOrderResponse.json();

      // 3. Sign Typed Data
      setStatus("Awaiting signature...");
      const { domain, types, message, primaryType } =
        preparedOrder.typedDataPayload;
      const account = walletClient.account.address as Address;
      const signature = await walletClient.signTypedData({
        account,
        domain,
        types,
        message,
        primaryType,
      } as TypedDataDefinition);

      // 4. Place Signed Order and let backend handle execution
      setStatus("Submitting signed order...");
      const placeOrderResponse = await fetch("/api/fusion-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "place-signed-order",
          preparationId: preparedOrder.preparationId,
          signature,
        }),
      });

      if (!placeOrderResponse.ok) {
        const errData = await placeOrderResponse.json();
        throw new Error(errData.error || "Failed to place signed order");
      }
      const placedOrder: PlaceSignedOrderResponse =
        await placeOrderResponse.json();
      setOrderHash(placedOrder.orderHash);
      setStatus("Order submitted. Processing in background...");
      setLoading(false);

      // Poll for final status until it's not "pending"
      const pollOrderStatus = async (orderHash: string) => {
        let currentStatus = "pending";
        while (currentStatus === "pending") {
          try {
            const statusCheckResponse = await fetch(
              `/api/fusion-order?action=status&orderHash=${orderHash}`
            );
            if (!statusCheckResponse.ok) {
              throw new Error(
                `Failed to fetch status: ${statusCheckResponse.statusText}`
              );
            }
            const orderStatusData = await statusCheckResponse.json();
            currentStatus = orderStatusData?.status || "unknown";
            setStatus(currentStatus);

            if (currentStatus !== "pending") {
              break; // Exit loop if status is no longer pending
            }
          } catch (pollError) {
            console.error("Error polling order status:", pollError);
            setStatus(`Error`);
            break; // Exit on error
          }
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
      };
      pollOrderStatus(placedOrder.orderHash);
    } catch (err: unknown) {
      console.error("Error creating Fusion+ order:", err);
      setError(formatError(err));
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        marginTop: "20px",
        border: "1px solid #ccc",
        padding: "15px",
        borderRadius: "8px",
      }}
    >
      <h2>Fusion+ Order Creation</h2>
      {isConnected ? (
        <>
          <p>Connected Wallet: {address}</p>
          <button
            onClick={handleCreateOrder}
            disabled={loading}
            style={{
              padding: "10px 20px",
              fontSize: "16px",
              cursor: "pointer",
            }}
          >
            {loading ? status || "Processing..." : "Create Fusion+ Order"}
          </button>
          {orderHash && <p>Order Hash: {orderHash}</p>}
          {status && <p>Status: {status}</p>}
          {error && <p style={{ color: "red" }}>Error: {error}</p>}
        </>
      ) : (
        <p>Please connect your wallet to create a Fusion+ order.</p>
      )}
    </div>
  );
};
