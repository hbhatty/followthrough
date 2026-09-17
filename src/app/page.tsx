import { cookies } from "next/headers";
import { listItems } from "../lib/collection";
import ReviewCollection from "./review";

export const dynamic = "force-dynamic";

export default async function CollectionPage() {
  const initialDarkMode = (await cookies()).get("followthrough-dark")?.value === "1";
  return <ReviewCollection items={listItems()} initialDarkMode={initialDarkMode} />;
}
