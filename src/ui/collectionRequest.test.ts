import { describe, expect, it } from "vitest";
import { COLLECTION_REQUESTS_REPO, collectionRequestUrl } from "./collectionRequest";

describe("the request link (KTD9)", () => {
  it("has no repo set in this build", () => {
    expect(COLLECTION_REQUESTS_REPO).toBeNull();
  });

  it("builds the new-issue URL with the template and an encoded title", () => {
    expect(collectionRequestUrl("workshop-maybe/andamio-collections")).toBe(
      "https://github.com/workshop-maybe/andamio-collections/issues/new?template=request-a-collection.yml&title=Collection%3A+",
    );
  });
});
