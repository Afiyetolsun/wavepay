import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { AppKitNetwork } from "@reown/appkit/networks";
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  gnosis,
  linea,
  mainnet,
  optimism,
  polygon,
  sonic,
  unichain,
  zksync,
} from "@reown/appkit/networks";
import { cookieStorage, createStorage } from "wagmi";

// Get projectId from https://cloud.reown.com
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || ""; // this is a public projectId only to use on localhost

if (!projectId) {
  throw new Error("Project ID is not defined");
}

export const networks = [
  mainnet,
  polygon,
  bsc,
  optimism,
  arbitrum,
  avalanche,
  gnosis,
  base,
  zksync,
  linea,
  sonic,
  unichain,
] as [AppKitNetwork, ...AppKitNetwork[]];

//Set up the Wagmi Adapter (Config)
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks,
});

export const config = wagmiAdapter.wagmiConfig;
