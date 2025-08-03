import { NextRequest, NextResponse } from "next/server";

const ONEINCH_API_KEY = process.env.DEV_PORTAL_KEY;


export async function GET(req: NextRequest) {
  const walletAddress = req.nextUrl.searchParams.get("walletAddress");
  const chainId = req.nextUrl.searchParams.get("chainId") || "1"; // Default to Ethereum Mainnet

  if (!walletAddress) {
    return NextResponse.json({ error: "Missing walletAddress" }, { status: 400 });
  }

  const url = `https://api.1inch.dev/balance/v1.2/${chainId}/balances/${walletAddress}`;
  const headers = {
    Authorization: `Bearer ${ONEINCH_API_KEY}`,
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || response.statusText || "Unknown error");
    }
    const data = await response.json();
    // Filter out tokens with zero balance and sort by balance (descending)
    const nonZeroBalances = Object.entries(data)
      .filter(([, balance]) => typeof balance === "string" && balance !== "0")
      .sort((a, b) => {
        // Sort by BigInt balance descending
        const balanceA = typeof a[1] === "string" ? BigInt(a[1]) : BigInt(0);
        const balanceB = typeof b[1] === "string" ? BigInt(b[1]) : BigInt(0);
        return balanceB > balanceA ? 1 : balanceB < balanceA ? -1 : 0;
      })
      .slice(0, 20); // Top 20 tokens

    const tokenAddresses = nonZeroBalances.map(([address]) => String(address));

    let tokensInfo = {};
    if (tokenAddresses.length > 0) {
      // Use the same chainId as for balances
      const tokenInfoUrl = `https://api.1inch.dev/token/v1.4/${chainId}/custom`;
      const tokenInfoRes = await fetch(
        tokenInfoUrl + `?addresses=${tokenAddresses.join(",")}`,
        { headers }
      );
      if (tokenInfoRes.ok) {
        tokensInfo = await tokenInfoRes.json();
      } else {
        // If token info fails, just return balances
        tokensInfo = {};
      }
    }

    // Merge balances and token info into a single array
    const tokensInfoMap = tokensInfo as Record<string, any>;
    const tokens = nonZeroBalances.map(([address, balance]) => {
      const info =
        tokensInfoMap && address in tokensInfoMap
          ? tokensInfoMap[address]
          : {};
      return {
        address,
        decimals: info.decimals,
        symbol: info.symbol,
        balance,
        rating: info.rating,
      };
    });

    return NextResponse.json({ tokens });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { error: error?.message || "Unknown error" },
      { status: 500 }
    );
  }
} 