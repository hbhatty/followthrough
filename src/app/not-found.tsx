import Link from "next/link";

export default function NotFound() {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <h1 id="not-found-title">This page isn’t here.</h1>
      <p>The address may be incorrect. Open your collection to continue reviewing.</p>
      <Link href="/">Back to collection</Link>
    </section>
  );
}
