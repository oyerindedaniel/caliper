import { Metadata } from "next";
import ChangelogPage from "./changelog-page";

export const metadata: Metadata = {
  title: "Changelog",
};

export default function Changelog() {
  return <ChangelogPage />;
}
