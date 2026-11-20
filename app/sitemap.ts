import type { MetadataRoute } from "next";

const SITE = "https://streetcodenyc.angelovasquez.net";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/algorithms", "/lab/index.html"].map((path) => ({
    url: SITE + path,
    changeFrequency: "weekly",
  }));
}
