import type { CollectionItem, StatusFilter } from "../../lib/types";

export const statusLabels: Record<StatusFilter, string> = {
  to_explore: "To explore",
  finished: "Finished",
  archived: "Archived",
  all: "All",
};

export const sourceLabels: Record<CollectionItem["source"], string> = {
  x: "X",
  youtube: "YouTube",
  website: "Website",
};

const addedTimestampFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function formatAddedTimestamp(value: string): string {
  return addedTimestampFormatter.format(Date.parse(value));
}
