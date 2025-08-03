# WavePay Demo

A Next.js application demonstrating crypto donation functionality using 1inch Fusion API for cross-chain swaps. This demo allows users to connect their wallet and donate crypto tokens across different blockchain networks.

## Features

- 🔗 **Wallet Connection**: Connect to Web3 wallets using Wagmi
- 💰 **Crypto Donations**: Donate any supported token to recipient addresses
- 🌉 **Cross-Chain Swaps**: Seamlessly swap tokens across different blockchain networks
- 📊 **Token Balance Display**: View and select from your available tokens
- ⚡ **Real-time Status**: Track transaction status and order processing
- 🎯 **1inch Integration**: Powered by 1inch Fusion API for optimal swap execution

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Web3**: Wagmi, Viem, Ethers.js
- **DeFi Integration**: 1inch Cross-Chain SDK, 1inch Limit Order SDK
- **Database**: PostgreSQL with pg client
- **Styling**: Tailwind CSS
- **State Management**: React Query (TanStack Query)
- **Wallet Integration**: Reown AppKit

## Prerequisites

- Node.js 18+
- PostgreSQL database
- 1inch Developer Portal API key

## Environment Variables

Create a `.env.local` file in the root directory:

```bash
# 1inch Developer Portal API key
DEV_PORTAL_KEY=your_1inch_api_key_here

# PostgreSQL database connection string
DATABASE_URL=postgresql://username:password@localhost:5432/wavepay_demo
```

## Getting Started

1. **Install dependencies**:

   ```bash
   npm install
   # or
   pnpm install
   ```

2. **Set up the database**:

   - Create a PostgreSQL database
   - Update the `DATABASE_URL` in your `.env.local` file

3. **Get a 1inch API key**:

   - Visit the [1inch Developer Portal](https://portal.1inch.dev/)
   - Create an account and get your API key
   - Add it to your `.env.local` file

4. **Run the development server**:

   ```bash
   npm run dev
   # or
   pnpm dev
   ```

5. **Open your browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

1. **Connect Wallet**: Click the "Connect Wallet" button to connect your Web3 wallet
2. **Select Token**: Choose from your available tokens (sorted by rating)
3. **Enter Amount**: Specify the donation amount
4. **Add Recipient**: Enter the recipient's wallet address
5. **Donate**: Click "Donate Crypto" to initiate the cross-chain swap

## API Endpoints

- `GET /api/balances` - Fetch user's token balances
- `GET /api/fusion-order` - Get quote for cross-chain swap
- `POST /api/fusion-order` - Prepare and place signed orders
- `GET /api/fusion-order-process` - Process order status updates

## Supported Networks

The application supports multiple blockchain networks through the 1inch Fusion API, including:

- Ethereum Mainnet
- Arbitrum
- Base
- Polygon
- And more...

## Development

### Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── balances/      # Token balance fetching
│   │   └── fusion-order/  # 1inch Fusion API integration
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Main page
├── components/             # React components
│   ├── ConnectButton.tsx  # Wallet connection
│   ├── CryptoDonateButton.tsx # Main donation interface
│   └── ...
├── config/                # Configuration files
└── context/               # React context providers
```

### Available Scripts

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [1inch Fusion API Documentation](https://docs.1inch.dev/)
- [Wagmi Documentation](https://wagmi.sh/)
- [Viem Documentation](https://viem.sh/)
