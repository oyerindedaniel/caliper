import { Metadata } from "next";
import AgenticDocsPage from "./agentic-page";

export const metadata: Metadata = {
  title: "Agentic",
  description:
    "Connect your browser to AI agents for high-precision design auditing and automated layout verification.",
};

export default function Page() {
  return <AgenticDocsPage />;
}
