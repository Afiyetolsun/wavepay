import { ConnectButton } from "@/components/ConnectButton";
import { CryptoDonateButton } from "@/components/CryptoDonateButton";

export default function Home() {
  return (
    <div className={"pages"}>
      <header className="header">
        <h1>WavePay Demo</h1>
        <ConnectButton />
      </header>
      <CryptoDonateButton />
      {/* <InfoList /> */}
    </div>
  );
}
