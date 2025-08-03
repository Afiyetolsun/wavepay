"use client";

import { Quote, QuoteParams, SupportedChains } from "@1inch/cross-chain-sdk";
import { useEffect, useState } from "react";
import { parseUnits } from "viem";
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


import { Address, TypedDataDefinition, TypedDataDomain } from "viem";

interface CryptoDonateButtonProps {
  initialRecipientAddress?: string;
  initialTokenName?: string;
}

// Polyfill isSupportedChain since it is not exported from the SDK
const isSupportedChain = (chain: unknown): boolean => SupportedChains.includes(chain as any);

// Token type for user tokens
export type Token = { address: string; decimals: number; symbol: string; balance: string; rating?: number };

export const CryptoDonateButton = ({
  initialRecipientAddress,
  initialTokenName,
}: CryptoDonateButtonProps) => {
  const { address, isConnected, chain } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [userTokens, setUserTokens] = useState<any[]>([]);
  const [selectedToken, setSelectedToken] = useState<any>(null);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isChainSupported, setIsChainSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (initialRecipientAddress) {
      setRecipientAddress(initialRecipientAddress);
    }
  }, [initialRecipientAddress]);

  useEffect(() => {
    if (chain?.id !== undefined) {
      setIsChainSupported(isSupportedChain(chain.id));
    } else {
      setIsChainSupported(null);
    }
  }, [chain]);

  // Fetch user tokens when address or chain changes
  useEffect(() => {
    const fetchTokens = async () => {
      if (!address || !chain?.id) {
        setUserTokens([]);
        setSelectedToken(null);
        return;
      }
      setTokensLoading(true);
      setTokensError(null);
      try {
        const res = await fetch(`/api/balances?walletAddress=${address}&chainId=${chain.id}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || res.statusText || "Failed to fetch tokens");
        }
        const data = await res.json();
        // New API: data.tokens is an array with address, decimals, symbol, balance, rating
        // Sort by rating descending
        const tokens = (Array.isArray(data.tokens) ? data.tokens : [])
          .slice()
          .sort((a: Token, b: Token) => (b.rating ?? 0) - (a.rating ?? 0));
        setUserTokens(tokens);
        // Set default selected token
        if (tokens.length > 0) {
          setSelectedToken(
            initialTokenName
              ? tokens.find((t: Token) => t.symbol === initialTokenName) || tokens[0]
              : tokens[0]
          );
        } else {
          setSelectedToken(null);
        }
      } catch (err: any) {
        setTokensError(err.message || "Failed to fetch tokens");
        setUserTokens([]);
        setSelectedToken(null);
      } finally {
        setTokensLoading(false);
      }
    };
    fetchTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, chain, initialTokenName]);

  const handleSwitchNetwork = async () => {
    if (!walletClient || !window.ethereum) return;
    // Try to switch to the first supported chain (ETH mainnet as example)
    const targetChainId = SupportedChains[0];
    try {
      await (window.ethereum as any).request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      });
    } catch {
      setError("Failed to switch network. Please switch manually in your wallet.");
    }
  };

  const handleDonate = async () => {
    if (!isConnected || !address || !walletClient || !walletClient.account) {
      setError(
        "Wallet client not ready or account not available. Please reconnect."
      );
      return;
    }
    if (!recipientAddress) {
      setError("Please enter a recipient address.");
      return;
    }
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      setError("Please enter a valid donation amount.");
      return;
    }
    if (!isChainSupported) {
      setError("The connected network is not supported. Please switch network.");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    setStatus(null);
    try {
      const srcTokenAddress = selectedToken.address;
      const dstTokenAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Target USDC on Base (example)
      const amountInUnits = parseUnits(amount, selectedToken.decimals).toString();
      const srcChainId = chain?.id;
      setStatus("Fetching quote for swap...");
      const quoteApiUrl = `/api/fusion-order?action=quote&walletAddress=${address}&srcTokenAddress=${srcTokenAddress}&dstTokenAddress=${dstTokenAddress}&amount=${amountInUnits}&srcChainId=${srcChainId}`;
      const quoteApiResponse = await fetch(quoteApiUrl);
      if (!quoteApiResponse.ok) {
        const errData = await quoteApiResponse.json();
        throw new Error(errData.error || "Failed to get quote from API");
      }
      const backendQuoteData: BackendQuoteResponse =
        await quoteApiResponse.json();
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait a bit to fix 429
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
      setSuccess(`Donation transaction sent! Order Hash: ${placedOrder.orderHash}`);
      setStatus("Order submitted. Processing in background...");
      setLoading(false);
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
      console.error("Error sending donation:", err);
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
      <h2>Crypto Donation</h2>
      {isConnected ? (
        <>
          <p>Connected Wallet: {address}</p>
          {isChainSupported === false && (
            <div style={{ color: "red", marginBottom: "10px" }}>
              <p>
                The connected network (chainId: {chain?.id}) is not supported for donations.<br />
                Supported networks: {SupportedChains.join(", ")}
              </p>
              <button onClick={handleSwitchNetwork} style={{ padding: "8px 16px", marginTop: "8px" }}>
                Switch to Supported Network
              </button>
            </div>
          )}
          <div style={{ marginBottom: "10px" }}>
            <label htmlFor="recipient">Recipient Address:</label>
            <input
              id="recipient"
              type="text"
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              placeholder="0x..."
              readOnly={!!initialRecipientAddress}
              style={{
                marginLeft: "10px",
                padding: "5px",
                width: "300px",
                backgroundColor: initialRecipientAddress ? "#eee" : "white",
              }}
            />
          </div>
          <div style={{ marginBottom: "10px" }}>
            <label htmlFor="token">Token:</label>
            <select
              id="token"
              value={selectedToken?.address || ""}
              onChange={(e) =>
                setSelectedToken(
                  userTokens.find((t) => t.address === e.target.value) || userTokens[0]
                )
              }
              style={{ marginLeft: "10px", padding: "5px" }}
              disabled={tokensLoading || userTokens.length === 0}
            >
              {tokensLoading ? (
                <option>Loading...</option>
              ) : userTokens.length === 0 ? (
                <option>No tokens found</option>
              ) : (
                userTokens.map((token: Token) => (
                  <option key={token.address} value={token.address}>
                    {token.symbol}
                  </option>
                ))
              )}
            </select>
            {tokensError && <span style={{ color: "red", marginLeft: 8 }}>{tokensError}</span>}
          </div>
          <div style={{ marginBottom: "10px" }}>
            <label htmlFor="amount">Amount ({selectedToken?.symbol || "Token"}):</label>
            <input
              id="amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.01"
              step="any"
              style={{ marginLeft: "10px", padding: "5px", width: "150px" }}
              disabled={!selectedToken}
            />
          </div>
          <button
            onClick={handleDonate}
            disabled={loading || isChainSupported === false || !selectedToken}
            style={{
              padding: "10px 20px",
              fontSize: "16px",
              cursor: loading || isChainSupported === false || !selectedToken ? "not-allowed" : "pointer",
            }}
          >
            {loading ? status || "Processing..." : "Donate Crypto"}
          </button>
          {success && <p style={{ color: "green" }}>{success}</p>}
          {status && <p>Status: {status}</p>}
          {error && <p style={{ color: "red" }}>Error: {error}</p>}
        </>
      ) : (
        <p>Please connect your wallet to make a donation.</p>
      )}
    </div>
  );
};
