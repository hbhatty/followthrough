import type { CollectionItem } from "../../src/lib/types";

export const demoItems = [
  {
    id: "demo-x-cache-notebook",
    source: "x",
    externalId: "900719925474099312345",
    sourceSortIndex: null,
    title: "A small notebook for cache surprises",
    author: "Mira Vale (fictional)",
    savedText:
      "Fictional sample post: Before changing a cache policy, write down the key, expiry rule, and what a stale result would mean. A tiny notebook can expose assumptions that a benchmark misses.",
    gist:
      "This fictional example suggests recording cache assumptions before tuning performance.",
    originalUrl: "https://example.com/fictional/x/cache-notebook",
    addedAt: "2026-09-12T10:00:00.000Z",
    status: "to_explore",
    rating: null,
    takeaway: null,
    isDemo: true,
  },
  {
    id: "demo-youtube-request-tracing",
    source: "youtube",
    externalId: "demoTrace01",
    sourceSortIndex: null,
    title: "Following one request through a tiny service",
    author: "Small Systems Studio (fictional)",
    savedText:
      "Fictional sample video description: Sketch a request from browser to database, then use a trace to compare the sketch with what actually happened. No real video is linked.",
    gist:
      "A fictional walkthrough of request tracing, with attention to waiting time between components.",
    originalUrl: "https://example.com/fictional/youtube/request-tracing",
    addedAt: "2026-09-11T15:30:00.000Z",
    status: "to_explore",
    rating: null,
    takeaway: null,
    isDemo: true,
  },
  {
    id: "demo-youtube-retry-budget",
    source: "youtube",
    externalId: "demoRetry01",
    sourceSortIndex: null,
    title: "When retries make a slow service slower",
    author: "The Patient Engineer (fictional)",
    savedText:
      "Fictional sample video description: A toy service gets overloaded when every caller retries immediately. The example compares a bounded retry budget with unbounded retries.",
    gist:
      "This fictional example explains how retries can amplify load during an outage.",
    originalUrl: "https://example.com/fictional/youtube/retry-budget",
    addedAt: "2026-09-10T09:00:00.000Z",
    status: "finished",
    rating: 4,
    takeaway:
      "Fictional personal takeaway: Count the total attempts a request can trigger across layers, not just the retries in one client.",
    isDemo: true,
  },
  {
    id: "demo-x-keyboard-garden",
    source: "x",
    externalId: "900719925474099312346",
    sourceSortIndex: null,
    title: "A keyboard for an imaginary greenhouse",
    author: "Rowan Finch (fictional)",
    savedText:
      "Fictional sample post: Today's imaginary invention is a keyboard that waters a different plant with every shortcut. The undo key is a tiny towel.",
    gist: "A fictional lighthearted post, not a technical task to complete.",
    originalUrl: "https://example.com/fictional/x/keyboard-garden",
    addedAt: "2026-09-09T18:00:00.000Z",
    status: "archived",
    rating: null,
    takeaway: null,
    isDemo: true,
  },
] satisfies readonly CollectionItem[];
